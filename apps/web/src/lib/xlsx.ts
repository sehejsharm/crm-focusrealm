import { unzipSync, strFromU8 } from "fflate";

/**
 * Reads the first worksheet of an Excel (.xlsx) file into rows of strings —
 * enough for importing a contact list, without a heavyweight spreadsheet
 * library. An .xlsx is a zip of XML parts: the shared-strings table, the
 * workbook (which sheet comes first) and the sheets themselves.
 */
export async function readXlsx(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const xml = (name: string) => (zip[name] ? new DOMParser().parseFromString(strFromU8(zip[name]), "application/xml") : null);
  const textOf = (el: Element) => Array.from(el.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");

  const shared = Array.from(xml("xl/sharedStrings.xml")?.getElementsByTagName("si") ?? []).map(textOf);

  // The first sheet in the workbook's order, resolved through its relationship id.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const first = xml("xl/workbook.xml")?.getElementsByTagName("sheet")[0];
  const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  if (rid) {
    const rel = Array.from(xml("xl/_rels/workbook.xml.rels")?.getElementsByTagName("Relationship") ?? []).find((r) => r.getAttribute("Id") === rid);
    const target = rel?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = xml(sheetPath);
  if (!sheet) throw new Error("Couldn't find a worksheet in that Excel file");

  const colIndex = (ref: string) => {
    const letters = ref.replace(/\d+$/, "");
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const grid: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName("row"))) {
    const cells: string[] = [];
    let next = 0;
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r");
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      cells[i] = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? textOf(c) : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
    }
    grid.push(Array.from(cells, (x) => (x ?? "").trim()));
  }
  const nonEmpty = grid.filter((r) => r.some(Boolean));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  // Header names must be unique for column matching.
  const seen = new Map<string, number>();
  const headers = nonEmpty[0].map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows };
}
