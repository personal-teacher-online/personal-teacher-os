// Leva 5 (itens 1–4 do e2e) — gera public/geo/cities.json a partir do GeoNames.
// Fonte: https://download.geonames.org/export/dump/ (licença CC-BY 4.0 — a
// atribuição obrigatória está no README e no rodapé do CityPicker).
// Uso: node scripts/build-cities.mjs   (baixa ~12 MB, escreve o JSON podado)
//
// Cada cidade vira { n, a, c, t, p [, b] }:
//   n = nome · a = região/UF · c = país (pt) · t = fuso IANA · p = população
//   b = apelido em português (camada curada — "Nova York", "Milão"…)
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = 'https://download.geonames.org/export/dump'

// País em pt-BR para os destinos prováveis dos alunos; fallback = nome EN.
const COUNTRY_PT = {
  BR: 'Brasil', US: 'Estados Unidos', PT: 'Portugal', GB: 'Reino Unido',
  ES: 'Espanha', FR: 'França', IT: 'Itália', DE: 'Alemanha', IE: 'Irlanda',
  NL: 'Países Baixos', BE: 'Bélgica', CH: 'Suíça', AT: 'Áustria',
  CA: 'Canadá', MX: 'México', AR: 'Argentina', CL: 'Chile', UY: 'Uruguai',
  PY: 'Paraguai', BO: 'Bolívia', PE: 'Peru', CO: 'Colômbia', VE: 'Venezuela',
  EC: 'Equador', JP: 'Japão', CN: 'China', KR: 'Coreia do Sul', IN: 'Índia',
  AU: 'Austrália', NZ: 'Nova Zelândia', ZA: 'África do Sul', AO: 'Angola',
  MZ: 'Moçambique', CV: 'Cabo Verde', AE: 'Emirados Árabes Unidos',
  SA: 'Arábia Saudita', QA: 'Catar', IL: 'Israel', TR: 'Turquia',
  GR: 'Grécia', PL: 'Polônia', CZ: 'Tchéquia', HU: 'Hungria',
  SE: 'Suécia', NO: 'Noruega', DK: 'Dinamarca', FI: 'Finlândia',
  RU: 'Rússia', UA: 'Ucrânia', RO: 'Romênia', HR: 'Croácia',
  TH: 'Tailândia', VN: 'Vietnã', ID: 'Indonésia', MY: 'Malásia',
  SG: 'Singapura', PH: 'Filipinas', EG: 'Egito', MA: 'Marrocos',
  LU: 'Luxemburgo', MT: 'Malta', CY: 'Chipre', IS: 'Islândia',
}

// Apelidos pt-BR (grafia local) → nome GeoNames + país. Camada curada do
// item 1: as cidades que os alunos realmente falam, do jeito que falam.
const ALIAS_PT = {
  'Nova York': ['New York City', 'US'], 'Nova Iorque': ['New York City', 'US'],
  'Londres': ['London', 'GB'], 'Milão': ['Milan', 'IT'], 'Roma': ['Rome', 'IT'],
  'Turim': ['Turin', 'IT'], 'Florença': ['Florence', 'IT'], 'Nápoles': ['Naples', 'IT'],
  'Veneza': ['Venice', 'IT'], 'Gênova': ['Genoa', 'IT'],
  'Paris': ['Paris', 'FR'], 'Marselha': ['Marseille', 'FR'], 'Lião': ['Lyon', 'FR'],
  'Munique': ['Munich', 'DE'], 'Colônia': ['Cologne', 'DE'], 'Berlim': ['Berlin', 'DE'],
  'Frankfurt': ['Frankfurt am Main', 'DE'], 'Hamburgo': ['Hamburg', 'DE'],
  'Viena': ['Vienna', 'AT'], 'Zurique': ['Zürich', 'CH'], 'Genebra': ['Genève', 'CH'],
  'Bruxelas': ['Brussels', 'BE'], 'Amsterdã': ['Amsterdam', 'NL'], 'Haia': ['The Hague', 'NL'],
  'Madri': ['Madrid', 'ES'], 'Madrid': ['Madrid', 'ES'], 'Barcelona': ['Barcelona', 'ES'],
  'Sevilha': ['Seville', 'ES'], 'Valência': ['Valencia', 'ES'],
  'Lisboa': ['Lisbon', 'PT'], 'Porto': ['Porto', 'PT'],
  'Dublim': ['Dublin', 'IE'], 'Edimburgo': ['Edinburgh', 'GB'],
  'Copenhague': ['Copenhagen', 'DK'], 'Estocolmo': ['Stockholm', 'SE'],
  'Oslo': ['Oslo', 'NO'], 'Helsinque': ['Helsinki', 'FI'],
  'Varsóvia': ['Warsaw', 'PL'], 'Cracóvia': ['Kraków', 'PL'], 'Praga': ['Prague', 'CZ'],
  'Budapeste': ['Budapest', 'HU'], 'Atenas': ['Athens', 'GR'], 'Moscou': ['Moscow', 'RU'],
  'Bucareste': ['Bucharest', 'RO'], 'Zagrebe': ['Zagreb', 'HR'],
  'Toronto': ['Toronto', 'CA'], 'Montreal': ['Montréal', 'CA'], 'Vancouver': ['Vancouver', 'CA'],
  'Cidade do México': ['Mexico City', 'MX'], 'Buenos Aires': ['Buenos Aires', 'AR'],
  'Santiago': ['Santiago', 'CL'], 'Montevidéu': ['Montevideo', 'UY'],
  'Assunção': ['Asunción', 'PY'], 'Bogotá': ['Bogotá', 'CO'], 'Lima': ['Lima', 'PE'],
  'Tóquio': ['Tokyo', 'JP'], 'Osaca': ['Osaka', 'JP'], 'Seul': ['Seoul', 'KR'],
  'Pequim': ['Beijing', 'CN'], 'Xangai': ['Shanghai', 'CN'], 'Hong Kong': ['Hong Kong', 'HK'],
  'Sydney': ['Sydney', 'AU'], 'Melbourne': ['Melbourne', 'AU'], 'Auckland': ['Auckland', 'NZ'],
  'Joanesburgo': ['Johannesburg', 'ZA'], 'Cidade do Cabo': ['Cape Town', 'ZA'],
  'Luanda': ['Luanda', 'AO'], 'Maputo': ['Maputo', 'MZ'], 'Praia': ['Praia', 'CV'],
  'Dubai': ['Dubai', 'AE'], 'Abu Dhabi': ['Abu Dhabi', 'AE'], 'Doha': ['Doha', 'QA'],
  'Tel Aviv': ['Tel Aviv', 'IL'], 'Jerusalém': ['Jerusalem', 'IL'],
  'Istambul': ['Istanbul', 'TR'], 'Cairo': ['Cairo', 'EG'], 'Casablanca': ['Casablanca', 'MA'],
  'Bangkok': ['Bangkok', 'TH'], 'Singapura': ['Singapore', 'SG'],
  'Miami': ['Miami', 'US'], 'Orlando': ['Orlando', 'US'], 'Boston': ['Boston', 'US'],
  'Los Angeles': ['Los Angeles', 'US'], 'São Francisco': ['San Francisco', 'US'],
  'Filadélfia': ['Philadelphia', 'US'], 'Washington': ['Washington, D.C.', 'US'],
  'Nova Orleans': ['New Orleans', 'US'], 'Chicago': ['Chicago', 'US'],
  'Houston': ['Houston', 'US'], 'Dallas': ['Dallas', 'US'], 'Atlanta': ['Atlanta', 'US'],
  'Seattle': ['Seattle', 'US'], 'Las Vegas': ['Las Vegas', 'US'], 'Denver': ['Denver', 'US'],
}

async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.text()
}

async function fetchZipEntry(url, entryName) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // unzip via CLI do sistema (evita dependência nova)
  const { execFileSync } = await import('node:child_process')
  const os = await import('node:os')
  const fs = await import('node:fs')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geonames-'))
  const zipPath = path.join(tmp, 'data.zip')
  fs.writeFileSync(zipPath, buf)
  execFileSync('unzip', ['-o', '-q', zipPath, entryName, '-d', tmp])
  return fs.readFileSync(path.join(tmp, entryName), 'utf8')
}

console.log('Baixando GeoNames (cities15000 + admin1 + países)…')
const [citiesTxt, admin1Txt, countryTxt] = await Promise.all([
  fetchZipEntry(`${BASE}/cities15000.zip`, 'cities15000.txt'),
  fetchText(`${BASE}/admin1CodesASCII.txt`),
  fetchText(`${BASE}/countryInfo.txt`),
])

const admin1 = new Map() // "BR.51" -> "Mato Grosso"
for (const line of admin1Txt.split('\n')) {
  const [code, name] = line.split('\t')
  if (code && name) admin1.set(code, name)
}
const countryEn = new Map() // "BR" -> "Brazil"
for (const line of countryTxt.split('\n')) {
  if (!line || line.startsWith('#')) continue
  const f = line.split('\t')
  if (f[0] && f[4]) countryEn.set(f[0], f[4])
}

const aliasByKey = new Map() // "name|CC" -> [apelidos pt]
for (const [pt, [name, cc]] of Object.entries(ALIAS_PT)) {
  const k = `${name}|${cc}`
  if (!aliasByKey.has(k)) aliasByKey.set(k, [])
  aliasByKey.get(k).push(pt)
}

const cities = []
let aliased = 0
for (const line of citiesTxt.split('\n')) {
  if (!line) continue
  const f = line.split('\t')
  const name = f[1]
  const cc = f[8]
  const adm = admin1.get(`${cc}.${f[10]}`) ?? ''
  const pop = Number(f[14]) || 0
  const tz = f[17]
  if (!name || !tz) continue
  const rec = {
    n: name,
    a: adm,
    c: COUNTRY_PT[cc] ?? countryEn.get(cc) ?? cc,
    t: tz,
    p: pop,
  }
  const aliases = aliasByKey.get(`${name}|${cc}`)
  if (aliases) {
    rec.b = aliases.join('|')
    aliased++
  }
  cities.push(rec)
}
cities.sort((x, y) => y.p - x.p)

// Poda de tamanho (veredito: ~1 MB): Brasil e Portugal INTEIROS (onde os
// alunos estão); resto do mundo só cidades ≥ 25 mil hab. A ordenação por
// população fica embutida na ORDEM do arquivo — o campo p sai.
const podadas = cities
  .filter((c) => c.c === 'Brasil' || c.c === 'Portugal' || c.p >= 25000)
  .map(({ p: _p, ...rest }) => rest)

mkdirSync('src/lib/geo', { recursive: true })
const out = 'public/geo/cities.json'
writeFileSync(out, JSON.stringify(podadas))
const kb = Math.round(Buffer.byteLength(JSON.stringify(podadas)) / 1024)
console.log(`✓ ${out}: ${podadas.length} cidades (de ${cities.length}), ${kb} KB, ${aliased} com apelido pt-BR`)
