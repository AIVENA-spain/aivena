# Kyero v3 test fixtures

`property-sync` had never run against a real feed, so its parser was unproven. These are **real
Kyero v3 feeds**, used to pin `kyero.ts` against reality rather than against our assumptions.

## Provenance

`openestate-kyero-v3.xml`, `openestate-kyero-v3-messy.xml` — from
[OpenEstate-IO](https://github.com/OpenEstate/OpenEstate-IO) (`Kyero/src/test/resources/kyero.xml`
and `kyero-3-upgrade.xml`), **Apache-2.0** — hence safe to redistribute here. The "messy" one is the
more valuable of the two: multiple properties, an `<agent>` block, several currencies, rental
`price_freq` values, and a property missing `surface_area`/`desc`/`images` entirely.

Kyero's own sample (`https://feeds.kyero.com/assets/kyero_v3_test_feed.xml`) is used for local
cross-checking but is deliberately **NOT committed**: it carries a bare copyright with no licence
grant. Fetching it to test an integration is its published purpose; redistributing it is not ours to
decide. It agrees with these fixtures on every field this parser reads.

Spec + schema (free, no account): `kyero_v3_import_spec.txt` (V3.8) and `kyeroV3.0.xsd` at
`https://feeds.kyero.com/assets/`, linked from
`https://help.kyero.com/estate-agents/xml-import-specification`. Kyero also host a feed validator.

## The `.parsed.json` files

Pre-parsed with the **exact** XMLParser options `index.ts` uses, so the shapes the tests assert are
the shapes production sees. This keeps `fast-xml-parser` out of the test path (the repo has no Node
copy of it, and the Edge Function pulls it from `npm:` under Deno).

Regenerate after changing the parser options in `index.ts`:

```sh
npm install fast-xml-parser@4 --prefix /tmp/fxp --no-save
node -e '
const fs=require("fs"), {XMLParser}=require("/tmp/fxp/node_modules/fast-xml-parser");
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",trimValues:true,parseTagValue:false});
const d="supabase/functions/property-sync/__fixtures__";
for(const [i,o] of [["openestate-kyero-v3.xml","openestate-kyero-v3.parsed.json"],
                    ["openestate-kyero-v3-messy.xml","openestate-kyero-v3-messy.parsed.json"]])
  fs.writeFileSync(`${d}/${o}`, JSON.stringify(parser.parse(fs.readFileSync(`${d}/${i}`,"utf8")),null,2)+"\n");
'
```

`parseTagValue:false` means every scalar arrives as a **string** (`"150"`, not `150`). The parser
relies on that; the tests pin it.
