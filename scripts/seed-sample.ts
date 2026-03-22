/**
 * Seed the UODO database with sample decisions and guidelines for testing.
 *
 * Includes real UODO decisions (Morele.net, Bisnode, Virgin Mobile)
 * and representative guidance documents so MCP tools can be tested without
 * running a full data ingestion pipeline.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["UODO_DB_PATH"] ?? "data/uodo.db";
const force = process.argv.includes("--force");

// --- Bootstrap database ------------------------------------------------------

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

// --- Topics ------------------------------------------------------------------

interface TopicRow {
  id: string;
  name_pl: string;
  name_en: string;
  description: string;
}

const topics: TopicRow[] = [
  {
    id: "consent",
    name_pl: "Zgoda",
    name_en: "Consent",
    description: "Zbieranie, ważność i wycofanie zgody na przetwarzanie danych osobowych (art. 7 RODO).",
  },
  {
    id: "cookies",
    name_pl: "Pliki cookies i śledzenie",
    name_en: "Cookies and trackers",
    description: "Umieszczanie i odczytywanie plików cookies i śledzących na urządzeniach użytkowników.",
  },
  {
    id: "transfers",
    name_pl: "Przekazywanie danych do państw trzecich",
    name_en: "International transfers",
    description: "Przekazywanie danych osobowych do państw trzecich lub organizacji międzynarodowych (art. 44–49 RODO).",
  },
  {
    id: "dpia",
    name_pl: "Ocena skutków dla ochrony danych (DPIA)",
    name_en: "Data Protection Impact Assessment (DPIA)",
    description: "Ocena ryzyka dla praw i wolności osób przy przetwarzaniu wysokiego ryzyka (art. 35 RODO).",
  },
  {
    id: "breach_notification",
    name_pl: "Naruszenie ochrony danych",
    name_en: "Data breach notification",
    description: "Zgłaszanie naruszeń ochrony danych do UODO i osób, których dane dotyczą (art. 33–34 RODO).",
  },
  {
    id: "privacy_by_design",
    name_pl: "Ochrona danych w fazie projektowania",
    name_en: "Privacy by design",
    description: "Uwzględnianie ochrony danych w fazie projektowania i domyślna ochrona danych (art. 25 RODO).",
  },
  {
    id: "employee_monitoring",
    name_pl: "Monitoring pracowników",
    name_en: "Employee monitoring",
    description: "Monitorowanie pracowników w miejscu pracy, w tym monitoring wizyjny i poczty elektronicznej.",
  },
  {
    id: "health_data",
    name_pl: "Dane dotyczące zdrowia",
    name_en: "Health data",
    description: "Przetwarzanie danych dotyczących zdrowia — szczególna kategoria danych (art. 9 RODO).",
  },
  {
    id: "children",
    name_pl: "Dane dzieci",
    name_en: "Children's data",
    description: "Ochrona danych osobowych dzieci, w szczególności w usługach internetowych (art. 8 RODO).",
  },
];

const insertTopic = db.prepare(
  "INSERT OR IGNORE INTO topics (id, name_pl, name_en, description) VALUES (?, ?, ?, ?)",
);

for (const t of topics) {
  insertTopic.run(t.id, t.name_pl, t.name_en, t.description);
}

console.log(`Inserted ${topics.length} topics`);

// --- Decisions ---------------------------------------------------------------

interface DecisionRow {
  reference: string;
  title: string;
  date: string;
  type: string;
  entity_name: string;
  fine_amount: number | null;
  summary: string;
  full_text: string;
  topics: string;
  gdpr_articles: string;
  status: string;
}

const decisions: DecisionRow[] = [
  // UODO — Morele.net — PLN 2.8 million
  {
    reference: "ZSPR.421.1.2019",
    title: "Decyzja UODO — Morele.net sp. z o.o. (naruszenie bezpieczeństwa danych)",
    date: "2019-08-26",
    type: "sanction",
    entity_name: "Morele.net sp. z o.o.",
    fine_amount: 2_830_410,
    summary:
      "UODO nałożył na Morele.net karę w wysokości 2 830 410 zł (ok. 644 780 EUR) za naruszenie ochrony danych osobowych ok. 2,2 mln klientów sklepu internetowego. Naruszenie polegało na wycieku danych klientów, w tym adresów e-mail, numerów telefonów i danych adresowych, do nieupoważnionych podmiotów. Prezes UODO uznał, że spółka nie wdrożyła odpowiednich środków technicznych i organizacyjnych chroniących dane.",
    full_text:
      "Prezes Urzędu Ochrony Danych Osobowych (UODO) przeprowadził postępowanie administracyjne wobec Morele.net sp. z o.o. w związku z naruszeniem ochrony danych osobowych klientów sklepu internetowego morele.net. Naruszenie nastąpiło w październiku 2018 r. i objęło dane ok. 2,2 mln klientów, w tym: adresy e-mail, numery telefonów, imiona i nazwiska, adresy dostawy. Nieupoważnione osoby wykorzystały zdobyte dane do rozsyłania wiadomości SMS z fałszywymi linkami płatności. UODO ustalił następujące naruszenia: (1) Brak odpowiednich środków technicznych i organizacyjnych — Morele.net nie wdrożyła wystarczających środków bezpieczeństwa, takich jak odpowiedni system uwierzytelniania i monitorowania dostępu do baz danych, co umożliwiło nieautoryzowany dostęp do danych klientów; (2) Brak regularnych testów i ocen skuteczności środków bezpieczeństwa — administrator nie przeprowadzał regularnych testów penetracyjnych i audytów bezpieczeństwa. Decyzja o nałożeniu kary uwzględniała: skalę naruszenia (2,2 mln osób), rodzaj danych (dane kontaktowe umożliwiające przeprowadzenie phishingu), brak wcześniejszych naruszeń ze strony spółki. Morele.net odwołała się od decyzji do Wojewódzkiego Sądu Administracyjnego.",
    topics: JSON.stringify(["breach_notification", "privacy_by_design"]),
    gdpr_articles: JSON.stringify(["5", "25", "32", "33"]),
    status: "final",
  },
  // UODO — Bisnode — EUR 220,000
  {
    reference: "ZSZZS.440.730.2019",
    title: "Decyzja UODO — Bisnode Polska sp. z o.o. (przetwarzanie danych bez wiedzy osób)",
    date: "2019-03-26",
    type: "sanction",
    entity_name: "Bisnode Polska sp. z o.o.",
    fine_amount: 943_000,
    summary:
      "UODO nałożył na Bisnode Polska karę w wysokości 943 470 zł (ok. 220 000 EUR) za przetwarzanie danych osobowych bez wypełnienia obowiązku informacyjnego. Bisnode przetwarzała dane ok. 6,1 mln osób z publicznych rejestrów (KRS, CEIDG) bez indywidualnego poinformowania ich o tym przetwarzaniu.",
    full_text:
      "Prezes UODO przeprowadził kontrolę u Bisnode Polska sp. z o.o., spółki z grupy Bisnode zajmującej się agregacją i sprzedażą danych biznesowych. Bisnode przetwarzała dane osobowe z publicznych rejestrów: Krajowego Rejestru Sądowego (KRS) i Centralnej Ewidencji i Informacji o Działalności Gospodarczej (CEIDG). Dane dotyczyły ok. 6,1 mln osób. UODO ustalił, że Bisnode: (1) Nie wypełniła obowiązku informacyjnego z art. 14 RODO — przy zbieraniu danych z źródeł innych niż bezpośrednio od osoby, administrator jest zobowiązany do przekazania im informacji o przetwarzaniu; Bisnode argumentowała, że indywidualne informowanie byłoby nieproporcjonalnie kosztowne (art. 14 ust. 5 lit. b RODO), jednak UODO uznał, że przetwarzanie danych jest prowadzone w celach komercyjnych, co nie uzasadnia wyłączenia obowiązku informacyjnego; (2) Bisnode poinformowała jedynie osoby, do których posiadała adresy e-mail (ok. 682 tys.), a pozostałych 5,4 mln osób nie poinformowała w żaden sposób. Decyzja UODO podkreślała, że obowiązek informacyjny jest fundamentem RODO i nie może być pominięty ze względów ekonomicznych w przypadku przetwarzania danych na dużą skalę dla celów komercyjnych.",
    topics: JSON.stringify(["transfers", "consent"]),
    gdpr_articles: JSON.stringify(["14", "5"]),
    status: "final",
  },
  // UODO — Virgin Mobile — marketing without consent
  {
    reference: "ZSPR.440.35.2020",
    title: "Decyzja UODO — Virgin Mobile Polska sp. z o.o. (marketing bez zgody)",
    date: "2020-09-10",
    type: "sanction",
    entity_name: "Virgin Mobile Polska sp. z o.o.",
    fine_amount: 1_769_500,
    summary:
      "UODO nałożył na Virgin Mobile Polska karę w wysokości 1 769 500 zł za wysyłanie komunikatów marketingowych do osób, które wcześniej wycofały swoją zgodę lub nigdy jej nie wyraziły, oraz za brak rzetelnych mechanizmów rejestracji i weryfikacji zgód.",
    full_text:
      "Prezes UODO wszczął postępowanie wobec Virgin Mobile Polska sp. z o.o. po serii skarg klientów otrzymujących niechciane wiadomości marketingowe. UODO ustalił następujące naruszenia: (1) Przetwarzanie danych w celach marketingowych po wycofaniu zgody — Virgin Mobile kontaktowała się z osobami, które wcześniej złożyły sprzeciw wobec przetwarzania danych w celach marketingowych lub wycofały zgodę; spółka nie wdrożyła skutecznych mechanizmów zapewniających respektowanie wycofania zgody; (2) Brak ważnej zgody — część odbiorców komunikatów marketingowych nigdy nie wyraziła zgody w sposób spełniający wymogi art. 7 RODO — zgody były bundlowane z regulaminami i nie spełniały wymogu dobrowolności i jednoznaczności; (3) Niewystarczające zapisy zgód — Virgin Mobile nie prowadziła wystarczająco szczegółowych rejestrów zgód umożliwiających udowodnienie, że zgoda została wyrażona zgodnie z RODO. UODO podkreślił wagę naruszenia: marketing bezpośredni jest jednym z najczęstszych naruszenia RODO w Polsce i prowadzi do znacznej uciążliwości dla konsumentów.",
    topics: JSON.stringify(["consent"]),
    gdpr_articles: JSON.stringify(["6", "7", "17", "21"]),
    status: "final",
  },
  // UODO — ID Finance — data breach
  {
    reference: "ZSPR.421.2.2021",
    title: "Decyzja UODO — ID Finance Poland sp. z o.o. (naruszenie danych klientów)",
    date: "2021-05-07",
    type: "sanction",
    entity_name: "ID Finance Poland sp. z o.o.",
    fine_amount: 1_069_850,
    summary:
      "UODO nałożył na ID Finance Poland karę w wysokości 1 069 850 zł za naruszenie ochrony danych osobowych ok. 140 000 klientów firmy pożyczkowej MoneyMan, w tym wrażliwych danych finansowych, oraz za brak zgłoszenia naruszenia do UODO w terminie 72 godzin.",
    full_text:
      "Prezes UODO przeprowadził postępowanie wobec ID Finance Poland sp. z o.o. — operatora platformy pożyczek krótkoterminowych MoneyMan — w związku z naruszeniem ochrony danych osobowych. Naruszenie polegało na ujawnieniu danych ok. 140 000 klientów, w tym: imion i nazwisk, numerów PESEL, numerów dowodów osobistych, adresów, numerów kont bankowych, danych o historii pożyczkowej. UODO ustalił: (1) Niedostateczne środki bezpieczeństwa — platforma nie stosowała odpowiednich mechanizmów uwierzytelniania wieloskładnikowego i szyfrowania danych wrażliwych; (2) Spóźnione zgłoszenie naruszenia — ID Finance zgłosiło naruszenie do UODO po 11 dniach od jego wykrycia, przekraczając obowiązkowy termin 72 godzin; (3) Brak powiadomienia osób dotkniętych naruszeniem — spółka nie powiadomiła poszkodowanych klientów o naruszeniu mimo, że dane wrażliwe finansowe zostały ujawnione, co stwarzało wysokie ryzyko dla praw i wolności osób. Kara uwzględniała wagę naruszenia, skalę (140 000 osób) oraz kategorie danych (dane finansowe i identyfikacyjne).",
    topics: JSON.stringify(["breach_notification", "privacy_by_design"]),
    gdpr_articles: JSON.stringify(["32", "33", "34"]),
    status: "final",
  },
  // UODO — Warsaw University — academic data
  {
    reference: "ZSZZS.440.1.2022",
    title: "Decyzja UODO — Szkoła Główna Handlowa (przetwarzanie danych studentów)",
    date: "2022-02-14",
    type: "decision",
    entity_name: "Szkoła Główna Handlowa w Warszawie",
    fine_amount: null,
    summary:
      "UODO nakazał Szkole Głównej Handlowej w Warszawie usunięcie naruszenia polegającego na udostępnieniu danych studentów na stronie internetowej uczelni bez podstawy prawnej oraz bez poinformowania studentów.",
    full_text:
      "Prezes UODO przeprowadził postępowanie wobec Szkoły Głównej Handlowej w Warszawie po skardze studenta, którego dane osobowe (imię, nazwisko, numer albumu, wyniki egzaminów) były udostępnione publicznie na stronie internetowej uczelni w sekcji dotyczącej wyników egzaminów. UODO ustalił: (1) Brak podstawy prawnej — uczelnia nie mogła powołać się na art. 6(1)(c) RODO (obowiązek prawny) dla publikacji danych studentów w internecie, gdyż przepisy prawa szkolnictwa wyższego nie wymagają takiej publikacji; (2) Brak informacji — studenci nie zostali poinformowani o tym, że ich dane będą publicznie dostępne w internecie; (3) Zasada minimalizacji danych — publikowanie imienia, nazwiska i numeru albumu wraz z wynikami egzaminów naruszało zasadę minimalizacji danych. UODO nakazał uczelni ograniczenie dostępu do danych studentów do systemu wymagającego uwierzytelnienia.",
    topics: JSON.stringify(["privacy_by_design", "consent"]),
    gdpr_articles: JSON.stringify(["5", "6", "13"]),
    status: "final",
  },
  // UODO — Towarzystwo Ubezpieczeń — retention
  {
    reference: "ZSZZS.440.580.2021",
    title: "Decyzja UODO — Towarzystwo Ubezpieczeń (nadmierny czas przechowywania danych)",
    date: "2021-11-18",
    type: "decision",
    entity_name: "Towarzystwo Ubezpieczeń (anonimizowane)",
    fine_amount: 85_000,
    summary:
      "UODO nałożył karę 85 000 zł na towarzystwo ubezpieczeniowe za przechowywanie danych osobowych byłych klientów przez okres przekraczający niezbędny do realizacji celów, dla których dane zostały zebrane.",
    full_text:
      "Prezes UODO wszczął postępowanie wobec towarzystwa ubezpieczeń po skardze byłego klienta, który odkrył, że jego dane osobowe były nadal przetwarzane przez ubezpieczyciela kilka lat po wygaśnięciu polisy. UODO ustalił: (1) Nadmierny okres przechowywania — ubezpieczyciel przechowywał dane byłych klientów (imię, nazwisko, adres, dane dotyczące stanu zdrowia podane przy zawarciu umowy) przez 15 lat po wygaśnięciu polisy, uzasadniając to potencjalnymi roszczeniami; jednak terminy przedawnienia roszczeń z umów ubezpieczenia wynoszą maksymalnie 3 lata (art. 819 k.c.); (2) Brak polityki retencji — ubezpieczyciel nie posiadał udokumentowanej polityki retencji danych określającej okresy przechowywania dla poszczególnych kategorii danych; (3) Przetwarzanie danych o stanie zdrowia — dane dotyczące zdrowia (szczególna kategoria danych art. 9 RODO) były przechowywane przez nadmiernie długi okres.",
    topics: JSON.stringify(["health_data", "privacy_by_design"]),
    gdpr_articles: JSON.stringify(["5", "9", "17"]),
    status: "final",
  },
  // UODO — Medial company — health data
  {
    reference: "DKN.5112.1.2021",
    title: "Decyzja UODO — Podmiot leczniczy (udostępnienie danych medycznych)",
    date: "2021-07-05",
    type: "sanction",
    entity_name: "Podmiot leczniczy (anonimizowane)",
    fine_amount: 10_000,
    summary:
      "UODO nałożył karę 10 000 zł na podmiot leczniczy za udostępnienie dokumentacji medycznej pacjenta osobie nieuprawionej z powodu błędu pracownika oraz za brak odpowiednich procedur weryfikacji tożsamości osoby odbierającej dokumentację.",
    full_text:
      "Prezes UODO przeprowadził postępowanie wobec podmiotu leczniczego po tym, jak dokumentacja medyczna pacjenta została wydana osobie nieuprawnionej. Pracownik rejestracji wydał dokumentację medyczną (historię choroby, wyniki badań) osobie, która przedstawiła się jako krewny pacjenta, bez weryfikacji jej tożsamości i bez sprawdzenia, czy pacjent upoważnił tę osobę do odbioru dokumentacji. UODO ustalił: (1) Brak odpowiednich procedur weryfikacji — placówka nie posiadała jasnych procedur weryfikacji tożsamości osób odbierających dokumentację medyczną; (2) Niedostateczne szkolenie personelu — pracownicy rejestracji nie zostali odpowiednio przeszkoleni w zakresie ochrony danych medycznych i procedur wydawania dokumentacji; (3) Naruszenie bezpieczeństwa szczególnej kategorii danych — dane medyczne stanowią szczególną kategorię danych wymagającą wzmożonej ochrony. UODO nakazał wdrożenie odpowiednich procedur weryfikacji i przeprowadzenie szkoleń personelu.",
    topics: JSON.stringify(["health_data", "privacy_by_design"]),
    gdpr_articles: JSON.stringify(["9", "32"]),
    status: "final",
  },
  // UODO — E-sklep — excessive data collection
  {
    reference: "DKN.5130.1.2020",
    title: "Decyzja UODO — Sklep internetowy (nadmierne zbieranie danych przy rejestracji)",
    date: "2020-06-22",
    type: "decision",
    entity_name: "Sklep internetowy (anonimizowane)",
    fine_amount: null,
    summary:
      "UODO nakazał sklepowi internetowemu zaprzestania zbierania numeru PESEL przy rejestracji konta klienta, uznając że nie jest to niezbędne do realizacji umowy sprzedaży i narusza zasadę minimalizacji danych.",
    full_text:
      "Prezes UODO wszczął z urzędu postępowanie wobec sklepu internetowego po stwierdzeniu, że przy rejestracji konta klienta wymagane jest podanie numeru PESEL jako pola obowiązkowego. UODO ustalił: (1) Naruszenie zasady minimalizacji danych — numer PESEL nie jest niezbędny do zawarcia i realizacji umowy sprzedaży detalicznej online; do realizacji umowy wystarczające są: imię i nazwisko, adres dostawy, adres e-mail i numer telefonu; (2) Brak podstawy prawnej — sklep nie wskazał przekonującej podstawy prawnej z art. 6 RODO uzasadniającej zbieranie numeru PESEL; powołanie się na art. 6(1)(b) (realizacja umowy) nie było uzasadnione, gdyż PESEL nie jest niezbędny do zawarcia i realizacji umowy sprzedaży; (3) Ryzyko dla osób — zbieranie numerów PESEL przez sklep internetowy bez uzasadnienia zwiększa ryzyko naruszenia danych w przypadku ataku na sklep. UODO nakazał usunięcie numeru PESEL z formularza rejestracji jako pola obowiązkowego.",
    topics: JSON.stringify(["privacy_by_design", "consent"]),
    gdpr_articles: JSON.stringify(["5", "6"]),
    status: "final",
  },
];

const insertDecision = db.prepare(`
  INSERT OR IGNORE INTO decisions
    (reference, title, date, type, entity_name, fine_amount, summary, full_text, topics, gdpr_articles, status)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertDecisionsAll = db.transaction(() => {
  for (const d of decisions) {
    insertDecision.run(
      d.reference,
      d.title,
      d.date,
      d.type,
      d.entity_name,
      d.fine_amount,
      d.summary,
      d.full_text,
      d.topics,
      d.gdpr_articles,
      d.status,
    );
  }
});

insertDecisionsAll();
console.log(`Inserted ${decisions.length} decisions`);

// --- Guidelines --------------------------------------------------------------

interface GuidelineRow {
  reference: string | null;
  title: string;
  date: string;
  type: string;
  summary: string;
  full_text: string;
  topics: string;
  language: string;
}

const guidelines: GuidelineRow[] = [
  {
    reference: "UODO-GUIDE-MONITORING-2019",
    title: "Wskazówki dotyczące monitoringu pracowników",
    date: "2019-06-12",
    type: "guideline",
    summary:
      "Wytyczne UODO dotyczące monitorowania pracowników w miejscu pracy. Obejmują monitoring wizyjny, monitoring poczty elektronicznej, GPS w pojazdach służbowych i monitoring aktywności internetowej pracowników w świetle RODO i Kodeksu pracy.",
    full_text:
      "Urząd Ochrony Danych Osobowych wydał wskazówki dotyczące monitorowania pracowników w kontekście RODO i znowelizowanego Kodeksu pracy (art. 22(2)–22(3) k.p.). Podstawy prawne monitoringu: Monitoring pracowników może być oparty na art. 6(1)(f) RODO (uzasadniony interes administratora) lub na art. 6(1)(c) (obowiązek prawny), jednak nie na zgodzie pracownika z uwagi na brak swobody jej wyrażenia. Monitoring wizyjny: pracodawca może stosować monitoring wizyjny wyłącznie w celu zapewnienia bezpieczeństwa pracowników lub ochrony mienia; nagrania należy przechowywać nie dłużej niż 3 miesiące; pracownicy muszą być poinformowani o monitoringu przed podjęciem pracy; nie wolno stosować monitoringu w pomieszczeniach sanitarnych, szatniach, stołówkach i miejscach wypoczynku. Monitoring poczty elektronicznej: pracodawca może monitorować służbową pocztę elektroniczną wyłącznie w celu zapewnienia organizacji pracy, prawidłowego użytkowania sprzętu i ochrony tajemnicy przedsiębiorstwa; pracownicy muszą być z wyprzedzeniem poinformowani o możliwości i zakresie monitoringu; UODO ostrzega przed monitoringiem prywatnej korespondencji pracowników. Rejestratory GPS: stosowanie GPS w pojazdach służbowych jest dozwolone dla celów zarządzania flotą i bezpieczeństwa, ale nie może być stosowane do stałego nadzoru pracowników poza godzinami pracy.",
    topics: JSON.stringify(["employee_monitoring", "consent"]),
    language: "pl",
  },
  {
    reference: "UODO-GUIDE-COOKIES-2022",
    title: "Pliki cookies i inne podobne technologie śledzące — poradnik dla administratorów",
    date: "2022-04-08",
    type: "guideline",
    summary:
      "Poradnik UODO dotyczący stosowania plików cookies i innych technologii śledzących. Obejmuje wymogi zgody, projekty banerów cookies, pliki zwolnione z wymogu zgody i obowiązki informacyjne.",
    full_text:
      "Urząd Ochrony Danych Osobowych opublikował poradnik dotyczący stosowania plików cookies i podobnych technologii śledzących w świetle RODO oraz art. 173 Prawa telekomunikacyjnego. Wymogi prawne: Przed umieszczeniem pliku cookie lub podobnej technologii na urządzeniu użytkownika należy uzyskać jego wyraźną zgodę, z wyjątkiem plików ściśle niezbędnych do świadczenia usługi elektronicznej; zgoda musi spełniać wymogi art. 7 RODO: dobrowolność, konkretność (dla każdej kategorii plików z osobna), świadomość i jednoznaczne działanie potwierdzające. Dobry wzorzec banera cookies: Baner musi zawierać co najmniej dwa równorzędne przyciski: \"Zaakceptuj wszystkie\" i \"Odrzuć wszystkie\"; nie wolno stosować przycisków wstępnie zaznaczonych; nie wolno stosować tzw. dark patterns utrudniających odmowę zgody; przycisk odmowy nie może być mniejszy, trudniej dostępny ani mniej widoczny niż przycisk akceptacji. Pliki zwolnione z wymogu zgody: pliki sesyjne (utrzymanie sesji), pliki koszyka zakupów, pliki uwierzytelniające, pliki zabezpieczające przed atakami. UODO przestrzega przed tzw. cookie walls — uzależnianiem dostępu do serwisu od wyrażenia zgody na śledzące pliki cookies.",
    topics: JSON.stringify(["cookies", "consent"]),
    language: "pl",
  },
  {
    reference: "UODO-GUIDE-DPIA-2021",
    title: "Ocena skutków dla ochrony danych (DPIA) — poradnik praktyczny",
    date: "2021-03-25",
    type: "guideline",
    summary:
      "Praktyczny poradnik UODO dotyczący przeprowadzania oceny skutków dla ochrony danych (DPIA/OSOD). Zawiera wykaz rodzajów przetwarzania wymagających obowiązkowej DPIA, metodologię trzyetapową oraz wymagania dokumentacyjne.",
    full_text:
      "Prezes UODO opublikował poradnik praktyczny dotyczący oceny skutków dla ochrony danych (OSOD/DPIA) na podstawie art. 35 RODO. DPIA jest obowiązkowa, gdy przetwarzanie może powodować wysokie ryzyko naruszenia praw lub wolności osób fizycznych. Wykaz rodzajów przetwarzania wymagających DPIA obowiązkowo: systematyczna i kompleksowa ocena czynników osobowych dotyczących osób fizycznych, oparta na zautomatyzowanym przetwarzaniu, w tym profilowaniu; przetwarzanie na dużą skalę szczególnych kategorii danych; systematyczne monitorowanie na dużą skalę miejsc dostępnych publicznie. Metodologia trzystopniowa: (1) Opis operacji przetwarzania i celów — jakie dane, w jakim celu, przez kogo, przez jak długo, komu przekazywane; (2) Ocena niezbędności i proporcjonalności — legalność, minimalizacja, dokładność, prawa osób; (3) Zarządzanie ryzykiem — identyfikacja zagrożeń (nieuprawniony dostęp, niechciana modyfikacja, utrata), ocena prawdopodobieństwa i wagi, dobór środków ograniczających ryzyko. DPIA musi być udokumentowana i aktualizowana przy istotnych zmianach przetwarzania. Jeśli ryzyko resztkowe jest wysokie mimo środków zaradczych, administrator jest zobowiązany do uprzedniej konsultacji z Prezesem UODO.",
    topics: JSON.stringify(["dpia", "privacy_by_design"]),
    language: "pl",
  },
  {
    reference: "UODO-GUIDE-BREACH-2020",
    title: "Naruszenia ochrony danych osobowych — jak postępować",
    date: "2020-10-15",
    type: "guideline",
    summary:
      "Wytyczne UODO dotyczące zarządzania naruszeniami ochrony danych i wypełniania obowiązku zgłoszenia do UODO (72 godziny) oraz powiadamiania osób, których dane dotyczą.",
    full_text:
      "Urząd Ochrony Danych Osobowych wydał wytyczne dotyczące naruszeń ochrony danych osobowych w świetle art. 33–34 RODO. Definicja naruszenia: naruszenie ochrony danych osobowych to naruszenie bezpieczeństwa prowadzące do przypadkowego lub niezgodnego z prawem zniszczenia, utracenia, zmodyfikowania, nieuprawnionego ujawnienia lub nieuprawnionego dostępu do danych osobowych. Przykłady: atak ransomware, nieuprawniony dostęp pracownika, wysłanie danych do złego odbiorcy, kradzież niezaszyfrowanego laptopa. Obowiązek zgłoszenia do UODO (art. 33 RODO): Administrator musi zgłosić naruszenie Prezesowi UODO bez zbędnej zwłoki, w miarę możliwości w ciągu 72 godzin od stwierdzenia naruszenia; jeśli zgłoszenie nie jest możliwe w terminie 72 godzin, administrator przekazuje je z opóźnieniem z wyjaśnieniem przyczyn opóźnienia; zgłoszenie obejmuje: charakter naruszenia, kategorie i przybliżoną liczbę osób i rekordów, skutki naruszenia, zastosowane lub proponowane środki zaradcze. Obowiązek powiadomienia osób (art. 34 RODO): Jeżeli naruszenie może powodować wysokie ryzyko dla praw i wolności osób fizycznych, administrator powiadamia te osoby bez zbędnej zwłoki. Rejestr naruszeń: Każde naruszenie — nawet to niezgłoszone do UODO — musi być udokumentowane w wewnętrznym rejestrze naruszeń.",
    topics: JSON.stringify(["breach_notification"]),
    language: "pl",
  },
  {
    reference: "UODO-GUIDE-CHILDREN-2021",
    title: "Ochrona danych osobowych dzieci w usługach online",
    date: "2021-08-01",
    type: "guideline",
    summary:
      "Wytyczne UODO dotyczące ochrony danych dzieci w usługach cyfrowych. Obejmują wymogi zgody, obowiązki informacyjne dostosowane do dzieci i wymagania dla usług skierowanych do dzieci.",
    full_text:
      "UODO opublikował wytyczne dotyczące ochrony danych osobowych dzieci w usługach społeczeństwa informacyjnego. Szczególna ochrona: Dane dzieci wymagają szczególnej ochrony, gdyż dzieci mogą być mniej świadome ryzyk związanych z przetwarzaniem ich danych. Zgoda w usługach online (art. 8 RODO): W przypadku usług społeczeństwa informacyjnego oferowanych bezpośrednio dzieciom, zgoda osoby poniżej 16. roku życia musi zostać wyrażona lub zatwierdzona przez osobę sprawującą władzę rodzicielską; Polska ustawa o ochronie danych osobowych (art. 5) obniżyła wiek, od którego dziecko może samodzielnie wyrazić zgodę, do 16 lat. Ochrona danych dzieci w praktyce: Usługi skierowane do dzieci powinny stosować prostszy i bardziej przystępny język w politykach prywatności; nie wolno stosować wobec dzieci technik psychologicznych mających na celu skłonienie ich do podania danych (gamification, nagrody); szczególna ostrożność przy profilowaniu dzieci i targetowaniu reklam.",
    topics: JSON.stringify(["children", "consent"]),
    language: "pl",
  },
];

const insertGuideline = db.prepare(`
  INSERT INTO guidelines (reference, title, date, type, summary, full_text, topics, language)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertGuidelinesAll = db.transaction(() => {
  for (const g of guidelines) {
    insertGuideline.run(
      g.reference,
      g.title,
      g.date,
      g.type,
      g.summary,
      g.full_text,
      g.topics,
      g.language,
    );
  }
});

insertGuidelinesAll();
console.log(`Inserted ${guidelines.length} guidelines`);

// --- Summary -----------------------------------------------------------------

const decisionCount = (
  db.prepare("SELECT count(*) as cnt FROM decisions").get() as { cnt: number }
).cnt;
const guidelineCount = (
  db.prepare("SELECT count(*) as cnt FROM guidelines").get() as { cnt: number }
).cnt;
const topicCount = (
  db.prepare("SELECT count(*) as cnt FROM topics").get() as { cnt: number }
).cnt;
const decisionFtsCount = (
  db.prepare("SELECT count(*) as cnt FROM decisions_fts").get() as { cnt: number }
).cnt;
const guidelineFtsCount = (
  db.prepare("SELECT count(*) as cnt FROM guidelines_fts").get() as { cnt: number }
).cnt;

console.log(`\nDatabase summary:`);
console.log(`  Topics:         ${topicCount}`);
console.log(`  Decisions:      ${decisionCount} (FTS entries: ${decisionFtsCount})`);
console.log(`  Guidelines:     ${guidelineCount} (FTS entries: ${guidelineFtsCount})`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
