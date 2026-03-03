#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const AxeBuilderModule = require("@axe-core/playwright");

const AxeBuilder = AxeBuilderModule.default || AxeBuilderModule;

const DEFAULT_URL = "http://localhost:3000/questionnaires";
const TARGET_URL = process.argv[2] || DEFAULT_URL;

const BREAKPOINTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 }
];

const BASE_DOM_ASSERTIONS = [
  { key: "sidebar_nav", selector: "[data-testid='app-sidebar-nav'], [data-testid='app-sidebar-nav-mobile']" },
  { key: "primary_nav", selector: "header nav[aria-label='Primary']" },
  { key: "main_landmark", selector: "main#main-content" }
];

const WORKBENCH_DOM_ASSERTIONS = [
  { key: "question_rail", selector: "[data-testid='question-rail-panel']" },
  { key: "main_answer_panel", selector: "[data-testid='answer-main-panel']" },
  { key: "evidence_panel", selector: "[data-testid='evidence-panel']" }
];

function shouldAssertWorkbenchSelectors(urlValue) {
  try {
    const parsed = new URL(urlValue);
    const path = parsed.pathname;
    return path.startsWith("/questionnaires/") && path !== "/questionnaires/";
  } catch {
    return false;
  }
}

const DOM_ASSERTIONS = shouldAssertWorkbenchSelectors(TARGET_URL)
  ? [...BASE_DOM_ASSERTIONS, ...WORKBENCH_DOM_ASSERTIONS]
  : BASE_DOM_ASSERTIONS;

function buildTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath, payload) {
  fs.writeFileSync(filePath, `${payload}\n`, "utf8");
}

function firstLine(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.split("\n")[0];
}

function summarizeAxe(axeResults) {
  const countsBySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
  for (const violation of axeResults.violations) {
    const key = violation.impact || "unknown";
    if (Object.prototype.hasOwnProperty.call(countsBySeverity, key)) {
      countsBySeverity[key] += 1;
    } else {
      countsBySeverity.unknown += 1;
    }
  }

  const topIssues = axeResults.violations.slice(0, 10).map((violation) => ({
    id: violation.id,
    impact: violation.impact || "unknown",
    description: violation.description,
    help: violation.help,
    helpUrl: violation.helpUrl,
    selectors: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    sampleFailure: firstLine(violation.nodes[0]?.failureSummary || "")
  }));

  return {
    violationCount: axeResults.violations.length,
    incompleteCount: axeResults.incomplete.length,
    inapplicableCount: axeResults.inapplicable.length,
    passCount: axeResults.passes.length,
    countsBySeverity,
    topIssues
  };
}

function toConsoleEntry(message, viewport) {
  const type = message.type();
  if (type !== "error" && type !== "warning" && type !== "warn") {
    return null;
  }

  const location = message.location();
  return {
    viewport,
    type,
    text: message.text(),
    location: {
      url: location.url || "",
      lineNumber: location.lineNumber || 0,
      columnNumber: location.columnNumber || 0
    }
  };
}

async function run() {
  const timestamp = buildTimestamp();
  const outputDir = path.join(process.cwd(), "artifacts", "ui-audit", timestamp);
  ensureDir(outputDir);

  const consoleEntries = [];
  const networkFailures = [];
  const networkFailureKeys = new Set();
  const domResults = [];
  const screenshots = [];
  let axeSummary = null;
  let axeRaw = null;

  const browser = await chromium.launch({ headless: true });

  try {
    for (let index = 0; index < BREAKPOINTS.length; index += 1) {
      const viewport = BREAKPOINTS[index];
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height }
      });
      const page = await context.newPage();

      page.on("console", (message) => {
        const entry = toConsoleEntry(message, viewport.name);
        if (entry) {
          consoleEntries.push(entry);
          const label = `[console:${entry.type}] [${entry.viewport}]`;
          process.stdout.write(`${label} ${entry.text}\n`);
        }
      });

      page.on("requestfailed", (request) => {
        const failure = request.failure();
        const item = {
          viewport: viewport.name,
          type: "requestfailed",
          method: request.method(),
          url: request.url(),
          errorText: failure?.errorText || "unknown"
        };
        const key = `${item.type}:${item.method}:${item.url}:${item.errorText}`;
        if (!networkFailureKeys.has(key)) {
          networkFailureKeys.add(key);
          networkFailures.push(item);
        }
      });

      page.on("response", (response) => {
        if (response.status() < 400) {
          return;
        }

        const request = response.request();
        const item = {
          viewport: viewport.name,
          type: "http_error",
          method: request.method(),
          status: response.status(),
          statusText: response.statusText(),
          url: response.url()
        };
        const key = `${item.type}:${item.method}:${item.status}:${item.url}`;
        if (!networkFailureKeys.has(key)) {
          networkFailureKeys.add(key);
          networkFailures.push(item);
        }
      });

      await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(800);

      const screenshotPath = path.join(outputDir, `screenshot-${viewport.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshots.push({
        breakpoint: viewport.name,
        viewport: `${viewport.width}x${viewport.height}`,
        file: screenshotPath
      });

      if (index === 0) {
        for (const assertion of DOM_ASSERTIONS) {
          const locator = page.locator(assertion.selector).first();
          let passed = false;
          let error = "";
          try {
            await locator.waitFor({ state: "visible", timeout: 3500 });
            passed = true;
          } catch (caught) {
            error = caught instanceof Error ? caught.message : "Element not found";
          }

          domResults.push({
            key: assertion.key,
            selector: assertion.selector,
            passed,
            error
          });
        }

        axeRaw = await new AxeBuilder({ page }).analyze();
        axeSummary = summarizeAxe(axeRaw);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  const summary = {
    auditedAt: timestamp,
    url: TARGET_URL,
    outputDir,
    screenshots,
    console: {
      total: consoleEntries.length,
      errors: consoleEntries.filter((entry) => entry.type === "error").length,
      warnings: consoleEntries.filter((entry) => entry.type === "warning" || entry.type === "warn").length
    },
    network: {
      failures: networkFailures.length
    },
    domAssertions: {
      total: domResults.length,
      passed: domResults.filter((item) => item.passed).length,
      failed: domResults.filter((item) => !item.passed).length
    },
    axe: axeSummary
  };

  writeJson(path.join(outputDir, "summary.json"), summary);
  writeJson(path.join(outputDir, "console-errors-warnings.json"), consoleEntries);
  writeJson(path.join(outputDir, "network-failures.json"), networkFailures);
  writeJson(path.join(outputDir, "dom-assertions.json"), domResults);

  if (axeSummary) {
    writeJson(path.join(outputDir, "axe-summary.json"), axeSummary);
  }
  if (axeRaw) {
    writeJson(path.join(outputDir, "axe-results.json"), axeRaw);
  }

  const reportLines = [
    `UI Audit Report`,
    `URL: ${TARGET_URL}`,
    `Artifacts: ${outputDir}`,
    `Screenshots:`,
    ...screenshots.map((item) => `- ${item.breakpoint} (${item.viewport}): ${item.file}`),
    `Console: ${summary.console.total} (errors: ${summary.console.errors}, warnings: ${summary.console.warnings})`,
    `Network failures: ${summary.network.failures}`,
    `DOM assertions: ${summary.domAssertions.passed}/${summary.domAssertions.total} passed`,
    `Axe violations: ${axeSummary ? axeSummary.violationCount : "n/a"}`,
    `Axe severity counts: ${axeSummary ? JSON.stringify(axeSummary.countsBySeverity) : "n/a"}`,
    `Top axe issues:`
  ];

  if (axeSummary && axeSummary.topIssues.length > 0) {
    axeSummary.topIssues.forEach((issue, issueIndex) => {
      reportLines.push(
        `${issueIndex + 1}. [${issue.impact}] ${issue.id} - ${issue.help}`,
        `   selector: ${issue.selectors[0] || "n/a"}`,
        `   description: ${issue.description}`
      );
    });
  } else {
    reportLines.push("- none");
  }

  const reportText = reportLines.join("\n");
  writeText(path.join(outputDir, "report.txt"), reportText);

  process.stdout.write("\n=== UI AUDIT SUMMARY ===\n");
  process.stdout.write(`${reportText}\n`);
  process.stdout.write("\n=== UI AUDIT JSON ===\n");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`ui audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
