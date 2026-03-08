#!/usr/bin/env node

const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const START_PORT = 5433;
const END_PORT = 5439;
const DB_CONTAINER_NAME = "securityq-autofill-db";
const DATABASE_URL_TEMPLATE = (port) => `postgresql://postgres:postgres@localhost:${port}/app?schema=public`;

function log(message) {
  process.stdout.write(`[test:db] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function candidatePorts() {
  const ports = [];
  const preferredPort = Number.parseInt(process.env.POSTGRES_PORT || "", 10);
  if (Number.isInteger(preferredPort) && preferredPort >= START_PORT && preferredPort <= END_PORT) {
    ports.push(preferredPort);
  }

  for (let port = START_PORT; port <= END_PORT; port += 1) {
    if (!ports.includes(port)) {
      ports.push(port);
    }
  }

  return ports;
}

function getExistingComposePort() {
  const result = spawnSync(
    "docker",
    ["ps", "--filter", `name=^/${DB_CONTAINER_NAME}$`, "--format", "{{.Ports}}"],
    {
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    return null;
  }

  const output = result.stdout.trim();
  if (!output) {
    return null;
  }

  const mapping = output
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.includes("->5432/tcp"));

  if (!mapping) {
    return null;
  }

  const hostPart = mapping.split("->5432/tcp")[0]?.trim() || "";
  const match = hostPart.match(/(\d+)$/);
  if (!match) {
    return null;
  }

  const port = Number.parseInt(match[1], 10);
  if (!Number.isInteger(port) || port < START_PORT || port > END_PORT) {
    return null;
  }

  return port;
}

function canBindToPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", () => {
      resolve(false);
    });

    server.listen(
      {
        port,
        host: "0.0.0.0",
        exclusive: true
      },
      () => {
      server.close(() => resolve(true));
      }
    );
  });
}

async function findAvailablePort() {
  for (const port of candidatePorts()) {
    if (await canBindToPort(port)) {
      return port;
    }
  }

  throw new Error(`No available Postgres port found in range ${START_PORT}-${END_PORT}.`);
}

function isPortReachable(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port
    });

    const finish = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForPort(port, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortReachable(port)) {
      await sleep(1000);
      return;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Postgres on localhost:${port}.`);
}

function runCommand(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const label = `${command} ${args.join(" ")}`;
    log(`Starting: ${label}`);

    const child = spawn(command, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        log(`Succeeded: ${label}`);
        resolve();
        return;
      }

      reject(
        new Error(
          signal ? `${label} exited due to signal ${signal}.` : `${label} exited with status ${code ?? "unknown"}.`
        )
      );
    });
  });
}

function runComposeUp(extraEnv) {
  return new Promise((resolve, reject) => {
    const label = "docker compose up -d";
    log(`Starting: ${label}`);

    const child = spawn("docker", ["compose", "up", "-d"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    let combinedOutput = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stderr.write(text);
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        log(`Succeeded: ${label}`);
        resolve();
        return;
      }

      const error = new Error(
        signal ? `${label} exited due to signal ${signal}.` : `${label} exited with status ${code ?? "unknown"}.`
      );
      error.combinedOutput = combinedOutput;
      reject(error);
    });
  });
}

function isDockerPortConflict(error) {
  const message = error && typeof error === "object" && "combinedOutput" in error
    ? String(error.combinedOutput || "")
    : String(error || "");

  return /port is already allocated|bind for .* failed/i.test(message);
}

async function main() {
  const existingPort = getExistingComposePort();
  let selectedPort = existingPort;

  if (existingPort) {
    log(`Reusing existing repo Postgres container on port ${selectedPort}.`);
    await runComposeUp({
      POSTGRES_PORT: String(selectedPort)
    });
  } else {
    let lastError = null;

    for (const port of candidatePorts()) {
      if (!(await canBindToPort(port))) {
        log(`Port ${port} is unavailable; trying next port.`);
        continue;
      }

      try {
        log(`Selected Postgres port ${port}.`);
        await runComposeUp({
          POSTGRES_PORT: String(port)
        });
        selectedPort = port;
        break;
      } catch (error) {
        lastError = error;
        if (isDockerPortConflict(error)) {
          log(`Port ${port} was claimed during Docker startup; trying next port.`);
          continue;
        }

        throw error;
      }
    }

    if (!selectedPort) {
      throw lastError || new Error(`No available Postgres port found in range ${START_PORT}-${END_PORT}.`);
    }
  }

  const databaseUrl = DATABASE_URL_TEMPLATE(selectedPort);
  log(`DATABASE_URL=${databaseUrl}`);

  const commandEnv = {
    POSTGRES_PORT: String(selectedPort),
    DATABASE_URL: databaseUrl
  };

  await waitForPort(selectedPort, 30000);
  await runCommand("npx", ["prisma", "migrate", "deploy"], commandEnv);
  await runCommand("npm", ["test"], commandEnv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`Failed: ${message}`);
  process.exit(1);
});
