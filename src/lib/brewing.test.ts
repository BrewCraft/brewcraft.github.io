/// <reference types="node" />
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { alcohol, carbonation, convertUnit, correctedHydrometer, correctedRefractometer, gravityAfterVolumeChange, hopFreshness, ibuTinseth, infusionWater, moreySrm, platoToSg, sgToPlato, strikeTemperature, tunCalibration, yeastPitch } from "./brewing";
import { calculators, validateCalculator } from "./calculator-registry";

const near = (actual: number, expected: number, tolerance = 0.00001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
test("Álcool / Atenuação / Calorias", () => {const a=alcohol(1.05,1.01,355);near(a.abv,5.25);near(a.apparent,80);near(a.calories,163.74,0.01);});
test("Taxa de Inoculação / Propagação de Levedura",()=>{const a=yeastPitch(20,1.05,0.75,1,100,90,1,1.4);near(a.available,90);near(a.propagated,230);near(a.extractGrams,100);near(a.needed,185.82,0.1);});
test("Refratômetro / Brix",()=>near(correctedRefractometer(12.4,6,1.04),1.00995068,0.00001));
test("Correção da Densidade / Evaporação",()=>{near(gravityAfterVolumeChange(1.05,25,20),1.0625);near(gravityAfterVolumeChange(1.05,20,25),1.04);});
test("Correção de Temperatura do Densímetro",()=>{near(correctedHydrometer(1.05,20,20),1.05);near(correctedHydrometer(1.05,30,20),1.0526,0.0001);});
test("Carbonatação",()=>{const a=carbonation(20,2.5,20,4);near(a.sugar,131.081024);const keg=carbonation(4,2.5,20,4);near(keg.psi,11.86204447);});
test("Frescor do Lúpulo",()=>{near(hopFreshness(12,25,180,20,1).alpha,9);near(hopFreshness(12,25,0,20,1).alpha,12);});
test("Conversão de Brassagem",()=>{const c=calculators.find(c=>c.id==="scale");assert.ok(c);const v={oldVolume:"20",newVolume:"40",oldEfficiency:"75",newEfficiency:"60",malt:"5",hops:"50",yeast:"11"};const results=c.calculate(v);near(results[1].value,12.5);near(results[2].value,100);near(results[3].value,22);});
test("Conversão de Gravidade",()=>{near(sgToPlato(1.05),12.3876,0.001);near(platoToSg(12),1.04838,0.0001);});
test("Conversão de Cor",()=>{const c=calculators.find(c=>c.id==="color");assert.ok(c);near(c.calculate({value:"10",unit:"srm"})[1].value,19.7);});
test("Conversão de unidade",()=>near(convertUnit(1,"length","in","mm"),25.4));
test("Conversão de volumes",()=>near(convertUnit(1,"volume","gal (US)","L"),3.785411784));
test("Conversão de peso",()=>near(convertUnit(1,"weight","lb","g"),453.59237));
test("Conversão de Temperatura",()=>{near(convertUnit(20,"temperature","°C","°F"),68);near(convertUnit(273.15,"temperature","K","°C"),0);});
test("Conversão de pressão",()=>near(convertUnit(1,"pressure","bar","psi"),14.5037738));
test("Calculadora de Temperatura Desejada",()=>near(strikeTemperature(5,15,20,67,0,20),73.423333));
test("Calculadora da Temperatura de Repouso",()=>near(infusionWater(5,15,63,72,100),5.480357));
test("Calibração da Panela de Mostura",()=>near(tunCalibration(5,15,20,75,20,67),0.50319149));
test("IBU e SRM existentes usam unidades corretas",()=>{near(ibuTinseth(30,12.5,60,20,1.05),43.2485,0.01);near(moreySrm(4,2,0.5,40,20),8.05521,0.00001);});
test("Química da água entra no conjunto de calculadoras",()=>{const c=calculators.find(c=>c.id==="water");assert.ok(c);const v={sourceCa:"80",sourceMg:"20",sourceNa:"10",sourceSo4:"30",sourceCl:"20",sourceHco3:"50",targetCa:"120",targetMg:"20",targetNa:"25",targetSo4:"100",targetCl:"60",targetHco3:"80",waterVolume:"30"};const result=c.calculate(v);assert.ok(result.some(r=>r.label.includes("Relação sulfato/cloreto")));assert.ok(result.some(r=>r.value>0 && r.label.toLowerCase().includes("gipsita")));});
test("Todas as calculadoras têm valores iniciais válidos",()=>{assert.equal(calculators.length,21);assert.equal(new Set(calculators.map(c=>c.id)).size,21);for(const c of calculators){const v=Object.fromEntries(c.fields.map(f=>[f.id,f.initial]));assert.equal(validateCalculator(c,v),undefined,c.id);for(const result of c.calculate(v))assert.ok(Number.isFinite(result.value),c.id);}});
test("Bloqueia volume zero, FG superior a OG e infusão insuficientemente quente",()=>{for(const [id,override] of [["evaporation",{final:"0"}],["alcohol",{fg:"1.06"}],["rest",{infusion:"70"}]] as const){const c=calculators.find(c=>c.id===id);assert.ok(c);const v={...Object.fromEntries(c.fields.map(f=>[f.id,f.initial])),...override};assert.ok(validateCalculator(c,v));}});