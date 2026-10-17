// Build a council's branded verdict PDF from the command line, without the room open.
// Same builder as the room's "Download PDF" button (app/public/pdf.js), run in Node.
// Useful when the browser room is out of reach, for example in a cloud session.
//
//   npm run pdf -- sessions/2026-10-09-example-take-the-seed
//   npm run pdf -- 2026-10-09-example-take-the-seed --out ~/Desktop/verdict.pdf
//
// Writes verdict.pdf into the session folder unless --out is given.
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT, SESSIONS_DIR } from "../lib/env.mjs";
import { byKey } from "../lib/seats.mjs";
import { getLive } from "../lib/watch.mjs";

const PUBLIC = path.join(APP_ROOT, "public");
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const outArg = outAt >= 0 ? args[outAt + 1] : null;
const target = args.find((a, i) => !a.startsWith("--") && (outAt < 0 || i !== outAt + 1));

if (!target) {
  console.error("Usage: npm run pdf -- <session folder> [--out file.pdf]");
  process.exit(1);
}

const name = path.basename(path.resolve(target));
const dir = path.join(SESSIONS_DIR, name);
if (!fs.existsSync(dir)) {
  console.error(`No session folder named ${name} in ${SESSIONS_DIR}`);
  process.exit(1);
}

// Councils run by the API runner save events.json; councils run in Claude Code are
// read from their files the same way the room plays them.
const savedFile = path.join(dir, "events.json");
const events = fs.existsSync(savedFile) ? JSON.parse(fs.readFileSync(savedFile, "utf8")).events : getLive(name)?.events || [];
const setup = events.find((e) => e.type === "setup");
const verdict = [...events].reverse().find((e) => e.type === "verdict");
if (!setup || !verdict) {
  console.error(`${name} has no verdict yet. The PDF needs council.json and verdict.json.`);
  process.exit(1);
}

// What pdf.js expects from the browser: the jsPDF global and fetch() for the room's
// own files (fonts and logo). The vendored jsPDF is a UMD bundle; this package is ESM,
// so load it as CommonJS by hand.
const umd = { exports: {} };
new Function("module", "exports", fs.readFileSync(path.join(PUBLIC, "vendor", "jspdf.umd.min.js"), "utf8"))(umd, umd.exports);
const { jsPDF } = umd.exports;
let pdf = null;
globalThis.window = {
  jspdf: {
    jsPDF: function (opts) {
      const doc = new jsPDF(opts);
      doc.save = () => { pdf = Buffer.from(doc.output("arraybuffer")); };
      return doc;
    },
  },
};
const browserFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  if (typeof url === "string" && url.startsWith("/")) {
    const file = path.normalize(path.join(PUBLIC, url));
    if (!file.startsWith(PUBLIC)) throw new Error(`refusing to read ${url}`);
    return new Response(fs.readFileSync(file));
  }
  return browserFetch(url, ...rest);
};

const { downloadVerdictPdf } = await import("../public/pdf.js");
await downloadVerdictPdf({ setup, verdict, byKey, id: name });
if (!pdf) {
  console.error("The PDF builder finished without a file.");
  process.exit(1);
}

const out = path.resolve(outArg || path.join(dir, "verdict.pdf"));
fs.writeFileSync(out, pdf);
console.log(`Verdict PDF written to ${out} (${Math.round(pdf.length / 1024)} KB)`);
process.exit(0);
