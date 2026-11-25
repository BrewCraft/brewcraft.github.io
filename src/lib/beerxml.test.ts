import test from "node:test";
import assert from "node:assert/strict";
import { recipeToBeerXml, parseBeerXml, parseBeerXmlAll } from "./beerxml";
import { defaultEquipment, type Recipe } from "./recipe-calc";

// Polyfill tipado de DOMParser para o ambiente Node.js de testes (no navegador é nativo)
if (typeof globalThis.DOMParser === "undefined") {
  class SimpleElement {
    tagName: string;
    private content: string;
    constructor(tag: string, content: string) {
      this.tagName = tag.toUpperCase();
      this.content = content;
    }
    get textContent(): string {
      return this.content
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
    }
    querySelector(selector: string): SimpleElement | null {
      const regex = new RegExp(`<${selector}>([\\s\\S]*?)</${selector}>`, "i");
      const match = this.content.match(regex);
      return match ? new SimpleElement(selector, match[1]) : null;
    }
    querySelectorAll(selector: string): SimpleElement[] {
      const regex = new RegExp(`<${selector}>([\\s\\S]*?)</${selector}>`, "gi");
      const results: SimpleElement[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(this.content)) !== null) {
        results.push(new SimpleElement(selector, match[1]));
      }
      return results;
    }
  }

  class MockDOMParser implements DOMParser {
    parseFromString(str: string): Document {
      const hasUnclosedTag = /<RECIPE>[\s\S]*$/i.test(str) && !/<\/RECIPE>/i.test(str);
      const hasUnescapedAmp = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(str.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ""));
      const hasParserError = !str.trim() || hasUnclosedTag || hasUnescapedAmp;
      const root = new SimpleElement("ROOT", str);
      const doc = {
        querySelector: (selector: string) => {
          if (selector === "parsererror") {
            return hasParserError ? (new SimpleElement("parsererror", "error") as unknown as Element) : null;
          }
          return root.querySelector(selector) as unknown as Element | null;
        },
        querySelectorAll: (selector: string) => {
          return root.querySelectorAll(selector) as unknown as NodeListOf<Element>;
        },
        getElementsByTagName: (tag: string) => {
          if (tag === "parsererror") {
            return (hasParserError ? [new SimpleElement("parsererror", "error")] : []) as unknown as HTMLCollectionOf<Element>;
          }
          return root.querySelectorAll(tag) as unknown as HTMLCollectionOf<Element>;
        },
      };
      return doc as unknown as Document;
    }
  }

  globalThis.DOMParser = MockDOMParser as unknown as typeof DOMParser;
}

const sampleRecipe: Recipe = {
  id: "rec-bxml",
  name: "American IPA BeerXML",
  styleCode: "21A",
  author: "Cervejeiro Mestre",
  notes: "Receita de teste para validação de BeerXML & símbolos < >",
  equipment: { ...defaultEquipment, batchL: 20, boilMinutes: 60, evaporationLh: 3.5, trubLossL: 1.5, fermenterLossL: 0.8, efficiency: 75 },
  mashSteps: [
    { name: "Parada Proteica", tempC: 52, minutes: 15 },
    { name: "Sacarificação", tempC: 66, minutes: 60 },
    { name: "Mash Out", tempC: 76, minutes: 10 },
  ],
  fermentationTempC: 18,
  fermentationDays: 14,
  fermentables: [
    { id: "f1", name: "Malte Pilsen", kg: 5.0, potential: 1.037, color: 3.5, type: "grao", price: 20 },
    { id: "f2", name: "Malte Munich", kg: 0.8, potential: 1.035, color: 15, type: "grao", price: 25 },
    { id: "f3", name: "Açúcar Cristal", kg: 0.3, potential: 1.046, color: 1, type: "acucar", price: 5 },
  ],
  hops: [
    { id: "h1", name: "Columbus", grams: 25, alpha: 14.5, minutes: 60, use: "fervura", price: 220 },
    { id: "h2", name: "Centennial", grams: 30, alpha: 10.0, minutes: 15, use: "whirlpool", price: 280 },
    { id: "h3", name: "Citra", grams: 50, alpha: 12.5, minutes: 0, use: "dryhop", dryHopDay: 5, price: 350 },
    { id: "h4", name: "Cascade", grams: 20, alpha: 6.0, minutes: 60, use: "primeiro_mosto", price: 200 },
  ],
  yeasts: [
    { id: "y1", name: "SafAle US-05", attenuation: 81, packs: 2, price: 35 },
  ],
  miscs: [
    { id: "m1", name: "Whirlfloc", amount: 1, unit: "un", use: "Fervura", price: 5 },
  ],
  createdAt: "2026-11-22T10:00:00Z",
  updatedAt: "2026-11-22T10:00:00Z",
  version: "1.0",
  versionHistory: [],
};

test("BeerXML: exportação contém todas as seções e tags obrigatórias da especificação 1.0", () => {
  const xml = recipeToBeerXml(sampleRecipe);

  assert.ok(xml.includes("<RECIPES>"));
  assert.ok(xml.includes("<RECIPE>"));
  assert.ok(xml.includes("<NAME>American IPA BeerXML</NAME>"));
  assert.ok(xml.includes("<BATCH_SIZE>20</BATCH_SIZE>"));
  assert.ok(xml.includes("<STYLE>"));
  assert.ok(xml.includes("<CATEGORY_NUMBER>21</CATEGORY_NUMBER>"));
  assert.ok(xml.includes("<STYLE_LETTER>A</STYLE_LETTER>"));
  assert.ok(xml.includes("<MASH>"));
  assert.ok(xml.includes("<MASH_STEP>"));
  assert.ok(xml.includes("<STEP_TEMP>66</STEP_TEMP>"));
  assert.ok(xml.includes("<USE>Dry Hop</USE>"));
  assert.ok(xml.includes("<USE>Aroma</USE>"));
  assert.ok(xml.includes("<USE>First Wort</USE>"));
  assert.ok(xml.includes("<PRIMARY_TEMP>18</PRIMARY_TEMP>"));
  assert.ok(xml.includes("<PRIMARY_AGE>14</PRIMARY_AGE>"));
});

test("BeerXML: round-trip preserva autor, preços, perdas, dryHopDay, notas e potencial", () => {
  const xml = recipeToBeerXml(sampleRecipe);
  const parsed = parseBeerXml(xml);

  assert.ok(parsed !== null);
  assert.equal(parsed.author, "Cervejeiro Mestre");
  assert.equal(parsed.notes, "Receita de teste para validação de BeerXML & símbolos < >");
  assert.equal(parsed.equipment?.trubLossL, 1.5);
  assert.equal(parsed.equipment?.fermenterLossL, 0.8);
  assert.ok(Math.abs((parsed.equipment?.evaporationLh ?? 0) - 3.5) < 0.1);

  const pilsen = parsed.fermentables?.find(f => f.name.includes("Pilsen"));
  assert.ok(pilsen);
  assert.ok(Math.abs((pilsen.potential || 0) - 1.037) < 0.0015);
  assert.equal(pilsen.price, 20);

  const citra = parsed.hops?.find(h => h.name === "Citra");
  assert.equal(citra?.use, "dryhop");
  assert.equal(citra?.dryHopDay, 5);
  assert.equal(citra?.price, 350);

  assert.equal(parsed.yeasts?.[0].price, 35);
  assert.equal(parsed.miscs?.[0].use, "Fervura");
  assert.equal(parsed.miscs?.[0].price, 5);
});

test("BeerXML: importação mapeia corretamente usos de lúpulo, MIN/MAX_ATTENUATION, EVAP_RATE, TRUB e MISC", () => {
  const beerSmithXml = `<?xml version="1.0" encoding="UTF-8"?>
  <RECIPES>
    <RECIPE>
      <NAME>BeerSmith Import</NAME>
      <BATCH_SIZE>20</BATCH_SIZE>
      <BOIL_SIZE>25</BOIL_SIZE>
      <BOIL_TIME>60</BOIL_TIME>
      <EFFICIENCY>75</EFFICIENCY>
      <EVAP_RATE>12</EVAP_RATE>
      <TRUB_CHILLER_LOSS>1.2</TRUB_CHILLER_LOSS>
      <HOPS>
        <HOP><NAME>Citra</NAME><AMOUNT>0.05</AMOUNT><ALPHA>12</ALPHA><USE>Dry Hop</USE><TIME>7200</TIME></HOP>
      </HOPS>
      <YEASTS>
        <YEAST><NAME>WLP001</NAME><MIN_ATTENUATION>73</MIN_ATTENUATION><MAX_ATTENUATION>81</MAX_ATTENUATION><AMOUNT>0.035</AMOUNT></YEAST>
      </YEASTS>
      <MISCS>
        <MISC><NAME>Irish Moss</NAME><USE>Boil</USE><AMOUNT>0.005</AMOUNT><AMOUNT_IS_WEIGHT>TRUE</AMOUNT_IS_WEIGHT></MISC>
      </MISCS>
    </RECIPE>
    <RECIPE>
      <NAME>Segunda Receita</NAME>
      <BATCH_SIZE>10</BATCH_SIZE>
      <BOIL_TIME>60</BOIL_TIME>
      <EFFICIENCY>70</EFFICIENCY>
    </RECIPE>
  </RECIPES>`;

  const all = parseBeerXmlAll(beerSmithXml);
  assert.equal(all.length, 2);
  assert.equal(all[0].name, "BeerSmith Import");
  assert.equal(all[1].name, "Segunda Receita");
  assert.equal(all[0].equipment?.trubLossL, 1.2);
  assert.equal(all[0].equipment?.evaporationLh, 3);
  assert.equal(all[0].yeasts?.[0].attenuation, 77);
  assert.equal(all[0].hops?.[0].use, "dryhop");
  assert.equal(all[0].hops?.[0].dryHopDay, 5);
  assert.equal(all[0].miscs?.[0].use, "Fervura");
  assert.equal(all[0].miscs?.[0].amount, 5);
  assert.equal(all[0].miscs?.[0].unit, "g");
});

test("BeerXML: resiliência contra XMLs corrompidos, parsererror e valores NaN", () => {
  assert.equal(parseBeerXml("<RECIPES><RECIPE><NAME>Quebrada"), null);
  assert.equal(parseBeerXml("<RECIPES><RECIPE><NAME>P&B Ale</NAME></RECIPE></RECIPES>"), null);
  assert.equal(parseBeerXml(""), null);
  assert.equal(parseBeerXml("<OUTRO_FORMATO><DADO>123</DADO></OUTRO_FORMATO>"), null);

  const nanXml = `<RECIPES><RECIPE>
    <NAME>NaN Safe</NAME>
    <BATCH_SIZE>abc</BATCH_SIZE>
    <BOIL_TIME>xyz</BOIL_TIME>
    <EFFICIENCY>bad</EFFICIENCY>
    <FERMENTABLES><FERMENTABLE><NAME>Malt</NAME><AMOUNT>bad</AMOUNT><COLOR>bad</COLOR></FERMENTABLE></FERMENTABLES>
    <HOPS><HOP><NAME>Hop</NAME><AMOUNT>bad</AMOUNT><ALPHA>bad</ALPHA><TIME>bad</TIME></HOP></HOPS>
  </RECIPE></RECIPES>`;
  const parsed = parseBeerXml(nanXml);
  assert.ok(parsed !== null);
  assert.equal(Number.isFinite(parsed.equipment?.batchL), true);
  assert.equal(parsed.fermentables?.[0].kg, 0);
  assert.equal(parsed.hops?.[0].grams, 0);
  assert.equal(parsed.hops?.[0].alpha, 0);
  assert.equal(parsed.hops?.[0].minutes, 0);
});
