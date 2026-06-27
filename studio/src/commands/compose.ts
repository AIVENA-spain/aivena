import { composeOne } from "../lib/compose";

export async function composeCmd(args: any): Promise<any> {
  const opts: any = {
    template: "04",
    lang: args.lang || "en",
    palette: args.palette || "source",
    mode: args.mode || "source_faithful",
    factsId: args.facts || "IC-26537",
  };
  if (args["name-base"]) opts.nameBase = args["name-base"];
  if (args.manifest) opts.manifestPath = args.manifest; // render an approved manifest by path (Q3 wiring)
  if (args["edit-slot"]) opts.edit = { slot: args["edit-slot"], text: args["edit-text"] || "" };
  if (args["editorial-lock"]) opts.editorialLock = { claim: args["editorial-lock"], approved_by: "agency_demo", scope: "template" };

  const res = await composeOne(opts);
  console.log(`COMPOSE ${res.ok ? "OK" : "FAIL"} [${res.lang}/${res.palette}/${res.mode}] -> out/phase2/04/04_${res.nameBase}.{svg,png,debug.png,qa.json}`);
  console.log(`  factuality: ${res.qa.factuality.status} | editability: ${res.qa.editability.ok ? "pass" : "FAIL"} | body variant: ${res.qa.fit_report.body?.chosen?.variant ?? "-"}`);
  if (!res.ok) { for (const f of res.qa.failures) console.error(`  FAIL ${f}`); throw new Error("compose failed QA (fail-closed)"); }
  return res;
}
