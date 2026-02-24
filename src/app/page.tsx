import Link from "next/link";

export default function Home() {
  const isDevMode = process.env.DEV_MODE === "true";

  return (
    <main>
      <h1>SecurityQ Autofill</h1>
      <p>Evidence-first security questionnaire workflows.</p>
      <ul>
        <li>
          <Link href="/documents">Go to Documents</Link>
        </li>
        <li>
          <Link href="/questionnaires">Go to Questionnaires</Link>
        </li>
        {isDevMode ? (
          <li>
            <Link href="/ask">Go to Ask</Link>
          </li>
        ) : null}
      </ul>
    </main>
  );
}
