import { writeFileSync } from "node:fs";
import path from "node:path";
import { auditPublisher, verifyPublisher } from "./publisher.mjs";
verifyPublisher(process.env.RELEASE_CLI);
const report = await auditPublisher();
import { mkdirSync } from "node:fs";
mkdirSync(path.join(process.env.RUNNER_TEMP, "publisher-report"), { recursive: true });
writeFileSync(
  path.join(process.env.RUNNER_TEMP, "publisher-report", "publisher-audit.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(`Publisher: ${report.auditedPackages} packages; ${report.findings.length} scoped accepted findings`);
