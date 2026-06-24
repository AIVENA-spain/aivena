import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { abs } from "../lib/paths";
import { loadManifest, manifestPath } from "../lib/manifest";

export async function validateManifestCmd(args: any): Promise<void> {
  const template = args.template || "04";
  const schemaPath = abs("manifest/schema.json");
  if (!fs.existsSync(schemaPath)) throw new Error(`Schema missing: ${schemaPath}`);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
  (addFormats as any)(ajv);
  const validate = ajv.compile(schema);
  const manifest = loadManifest(template);
  const ok = validate(manifest);
  if (!ok) {
    console.error(`MANIFEST INVALID: ${manifestPath(template)}`);
    for (const e of validate.errors || []) {
      console.error(`  ${e.instancePath || "(root)"} ${e.message}${e.params ? " " + JSON.stringify(e.params) : ""}`);
    }
    throw new Error("manifest schema validation FAILED");
  }
  console.log(`MANIFEST VALID (schema 2020-12): ${manifestPath(template)}`);
}
