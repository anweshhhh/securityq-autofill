import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>SecurityQ Autofill</h1>
      <p>
        Scaffold is live. The API health check is available at <code>/api/health</code>.
      </p>
      <ul>
        <li>
          <Link href="/documents">Go to Documents</Link>
        </li>
        <li>
          <a href="/api/health" target="_blank" rel="noreferrer">
            Open API Health
          </a>
        </li>
        <li>
          <a href="/api/documents" target="_blank" rel="noreferrer">
            Open API Documents
          </a>
        </li>
      </ul>
    </main>
  );
}
