# Investigação do formato BSMX (BeerSmith 2.x)

## Conclusão

Não foi implementado um importador BSMX. O formato é proprietário do BeerSmith e não possui especificação pública confiável suficiente para uma implementação correta no BrewCraft.

## O que é BSMX

- Formato nativo do BeerSmith 2/3/4 (extensão `.bsmx`).
- Container XML proprietário utilizado para receitas, bibliotecas de ingredientes e perfis.
- Não é BeerXML nem BeerJSON.

## Evidências coletadas

1. Documentação oficial do BeerSmith descreve o BSMX como formato XML estendido, sem publicar um schema formal (XSD/JSON Schema) reutilizável.
2. O BSMX não é XML válido estrito: utiliza entidades HTML nomeadas (`&ldquo;`, `&nbsp;`) que um parser XML padrão rejeita.
3. `Archive.bsmx` pode ser um fragmento XML sem elemento raiz.
4. As unidades internas são US customary (oz, fl oz, °F, bilhões de células), independentemente das configurações de exibição do usuário.
5. O arquivo não contém estimativas calculadas (OG, FG, IBU, cor, ABV, eficiência) — são recalculadas pelo BeerSmith ao abrir.
6. Cores de fermentáveis são expressas em SRM, não em Lovibond como declarado pelo BeerXML.
7. Atenuação de levedura é armazenada como faixa (min/max), não como valor único.
8. Existem registros "phantom" (base grain) que não são ingredientes reais.
9. Temperaturas/durações padrão podem aparecer em etapas de fermentação não utilizadas.

## O que falta para uma implementação correta

1. Schema formal (XSD ou equivalente) publicado pelo BeerSmith.
2. Especificação documentada das tags, tipos e unidades internas.
3. Regras de conversão US customary → métrico (kg, L, °C) validadas contra arquivos reais de múltiplas versões do BeerSmith.
4. Tratamento de entidades HTML e fragmentos XML.
5. Heurísticas para filtrar registros phantom (base grain) e etapas não utilizadas.
6. Conjunto de arquivos `.bsmx` de teste reais (receitas, ingredientes, perfis) de BeerSmith 2/3/4.
7. Decisão de produto sobre preservação de campos sem representação no modelo interno do BrewCraft (custos, datas, parâmetros BIAB/batch-sparge).

## Recomendação

Enquanto não houver especificação formal e arquivos de teste reais, não implementar importador BSMX para evitar perda silenciosa ou corrupção de dados. Os formatos suportados permanecem BeerXML 1.0 e BeerJSON 1.x.