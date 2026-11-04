# Benutzerhandbuch

Dieses Handbuch beschreibt, wie du die VS-Code-Erweiterung von Computor als Student:in, Tutor:in oder Lehrende:r verwendest.

Nach der Anmeldung öffnet sich die Seite **Willkommen bei Computor**, die deine
Kurse, einen schrittweisen Einstieg in deine erste Aufgabe, die Hilfeseiten, die
Bedeutung der Git-Farben im Editor und einen Hinweis auf die Browser- und die
Desktop-Version enthält. Du öffnest sie erneut mit **Computor: Willkommen und
Hilfe** oder mit dem Fragezeichensymbol oben in der Student-, der Tutor- und der
Lehrenden-Ansicht. Entfernst du das Häkchen bei *Diese Seite beim Start von
Computor anzeigen*, öffnet sie sich nicht mehr von selbst.

Wenn du einen gehosteten Arbeitsbereich aus einem Kurs heraus öffnest, zeigt die
Student-Ansicht unmittelbar diesen Kurs und dessen Begrüßung oder die Anleitung
zur ersten freigegebenen Übung an. Das gilt auch für einen bereits laufenden
Arbeitsbereich, der dabei zu dem Kurs wechselt, aus dem heraus du ihn geöffnet hast. Solange du nur
eine Anleitung liest, wird kein Repository heruntergeladen; klappe eine Übung erst auf, wenn du mit der
Arbeit beginnen willst. Um zu einem anderen Kurs zu wechseln, in dem du angemeldet
bist, klickst du in der Statusleiste auf den Kursnamen oder führst **Computor
Studierende: Kurs wechseln** aus.

## Inhaltsverzeichnis

- [Erste Schritte](#erste-schritte)
- [Leitfaden für Studierende](#leitfaden-für-studierende)
- [Leitfaden für Tutor:innen](#leitfaden-für-tutorinnen)
- [Leitfaden für Lehrende](#leitfaden-für-lehrende)
- [Häufige Aufgaben](#häufige-aufgaben)
- [Fehlerbehebung](#fehlerbehebung)

## Erste Schritte

### Ersteinrichtung

1. **Öffne einen Ordner** in VS Code
   - Die Erweiterung funktioniert nur in einem geöffneten Arbeitsbereich
   - Mit `Datei > Ordner öffnen` öffnest oder erstellst du einen Ordner

2. **Melde dich bei Computor an**
   - Öffne die Befehlspalette (`Strg+Umschalt+P`, macOS: `Cmd+Umschalt+P`)
   - Führe `Computor: Backend-URL ändern` aus und gib die Adresse des Computor-Servers (Backend-URL) ein, die dir deine Hochschule nennt
     (voreingestellt ist `http://localhost:8000`, ein lokales Entwicklungs-Backend)
   - Führe `Computor: Anmelden` aus
   - Dein Browser öffnet die Single-Sign-on-Seite deiner Hochschule; melde dich dort an und
     kehre zu VS Code zurück, sobald die Seite **Bei Computor angemeldet** anzeigt
   - Für Automatisierung oder Arbeitsbereiche ohne Oberfläche (headless) führst du stattdessen
     `Computor: Mit API-Token anmelden` aus oder setzt die Umgebungsvariable `COMPUTOR_AUTH_TOKEN`

3. **Öffne deine Ansicht**
   - Nach der Anmeldung erscheinen die passenden Ansichten in der Aktivitätsleiste
   - Klicke auf das Symbol, um die Ansicht deiner Rolle zu öffnen:
     - 📖 Student-Ansicht
     - 👤 Tutor-Ansicht
     - 🎓 Lehrenden-Ansicht

### Konfiguration

#### Backend-URL
Die Backend-URL kannst du jederzeit ändern:
- Befehl: `Computor: Backend-URL ändern`

#### Benutzerprofil
So bearbeitest du deine Profilangaben:
- Klicke in der Titelleiste der Ansicht auf das Kontosymbol
- Befehl: `Computor: Profil bearbeiten`

---

## Leitfaden für Studierende

Als Student:in kannst du Kurse ansehen, Aufgaben bearbeiten, Tests ausführen und deine Arbeit abgeben.

### In Kursen navigieren

1. Öffne in der Aktivitätsleiste die Ansicht **Computor Studierende**
2. Sieh dir die Baumstruktur an:
   ```
   Kursname
   ├── 📁 Kursgruppe (optional)
   ├── 📄 Inhalt
   └── 📝 Aufgabe
   ```

### Aufgaben bearbeiten

#### Dein Kurs-Repository

Alle Aufgaben eines Kurses liegen in einem einzigen Repository, das dir gehört. Es
wird automatisch angelegt und heruntergeladen, wenn du den Kurs zum ersten Mal
öffnest; ist das fehlgeschlagen, klickst du mit der rechten Maustaste auf den Kurs
und wählst `Repository einrichten`. Ein Klick auf eine Aufgabe zeigt dir die Aufgabenstellung,
und wenn du sie aufklappst, siehst du ihre Dateien.

#### Tests ausführen

1. Klicke neben der Aufgabe auf das **Becherglas**-Symbol
   - Oder Rechtsklick → `Aufgabe testen`
2. Computor sichert deine Arbeit mit einem Commit, lädt sie hoch und führt die Tests auf dem Server aus
3. Die Ergebnisse siehst du im Bereich **Testergebnisse** (unten im Fenster)
4. Ein Klick auf einen fehlgeschlagenen Test führt dich zu dem Code, um den es geht

#### Änderungen sichern (Commit)

1. Ändere deinen Code
2. Klicke neben der Aufgabe auf das **Commit**-Symbol
   - Oder Rechtsklick → `Aufgabe sichern (Commit)`
3. Die Änderungen werden committet und in dein Repository hochgeladen

Da sich alle Aufgaben eines Kurses ein Repository teilen, sichert `Kurs sichern (Commit)`
an der Kurszeile in einem Schritt alles, woran du gearbeitet hast.

#### Dateien einer Aufgabe verwalten

Klicke mit der rechten Maustaste auf eine Aufgabe oder eine Datei darin:

- `Neue Datei…` / `Neuer Ordner…`
- `Datei kopieren…` / `Datei verschieben…` — wähle ein Ziel innerhalb derselben Aufgabe
- `Datei löschen` / `Ordner löschen`
- `Umbenennen…`, `Duplizieren`, `Ausschneiden` / `Kopieren` / `Einfügen`
- `Pfad kopieren`, `Relativen Pfad kopieren`, `Im Dateimanager anzeigen`

All das geschieht nur lokal, bis du es sicherst (Commit). `.git` sowie `README.md`
und `mediaFiles`, die zur Aufgabe gehören, verwaltet Computor, sodass du sie
nicht ändern kannst.

#### Gelöschtes Material wiederherstellen

Klicke mit der rechten Maustaste auf den Kurs und wähle `Repository aus Kursvorlage aktualisieren`. Dabei
wird neu freigegebenes Material übernommen und jede Datei wiederhergestellt, die in
der Kursvorlage vorhanden ist, in deinem Ordner aber fehlt. Dateien, die du noch
hast, bleiben unberührt. Um eine verdorbene Datei frisch zu erhalten, löschst du
sie deshalb zuerst (und kopierst sie vorher an einen anderen Ort, wenn du deine
Fassung behalten willst).

#### Eine Kopie deiner Arbeit aufbewahren

Rechtsklick auf den Kurs → `Kursaufgaben exportieren…` packt die Aufgaben, die du
auf deinem Rechner hast, in eine ZIP-Datei. Im Browser wird sie in deinem
Arbeitsbereich unter `exports/` gespeichert und auf deinen Computer heruntergeladen,
sodass dir deine Arbeit auch nach dem Ende deiner Kursanmeldung bleibt.

#### Aufgabe abgeben

1. Teste deinen neuesten Stand, denn Computor gibt den getesteten Commit ab
2. Klicke neben der Aufgabe auf das **Upload**-Symbol
   - Oder Rechtsklick → `Abgeben`
3. Die Abgabe wird auf dem Server angelegt
4. Die Details der Abgabe siehst du über Rechtsklick → `Details anzeigen`

### Rückmeldungen ansehen

- **Testergebnisse**: Klicke an einer beliebigen Aufgabe auf `Testergebnisse anzeigen`
- **Nachrichten**: Rechtsklick auf einen Inhalt → `Nachrichten anzeigen` für Ankündigungen
- **Anleitung**: Ein Klick auf das Vorschausymbol zeigt dir die Aufgabenstellung

### Tipps für Studierende

- **Sichere oft**: Nutze regelmäßig `Kurs sichern (Commit)` oder `Aufgabe sichern (Commit)`, damit dein Fortschritt erhalten bleibt
- **Teste vor dem Abgeben**: Führe vor der endgültigen Abgabe immer die Tests aus
- **Lies die Nachrichten**: Lehrende und Tutor:innen veröffentlichen dort unter Umständen wichtige Neuigkeiten
- **Mehrere Kurse**: Du kannst an mehreren Kursen arbeiten; jeder Kurs hat sein eigenes Repository, jede Aufgabe darin ihren eigenen Ordner

---

## Leitfaden für Tutor:innen

Als Tutor:in kannst du Studierende im Blick behalten, ihre Repositorys klonen, ihre Arbeit durchsehen sowie Bewertungen und Rückmeldungen geben.

### Studierende filtern

In der Ansicht **Kurse und Teilnehmende** wählst du aus, wessen Arbeit du durchsehen willst:

1. Öffne die Ansicht **Computor Tutor**
2. Klicke unter **Kurse und Teilnehmende** auf einen Kurs
3. Schränke die Liste der Teilnehmenden mit **Kursgruppen** auf eine Gruppe ein
4. Klicke auf eine Person, um ihre Inhalte in die Ansicht **Kurse** zu laden
5. Klicke in der Statusleiste auf den Tutor-Eintrag (`Tutor: Filter zurücksetzen`), um die Auswahl aufzuheben

### Arbeiten von Studierenden ansehen

Die Ansicht **Kurse** beginnt mit drei Zeilen, die deine Auswahl wiederholen, gefolgt
von den Einheiten und Aufgaben der Person:
```
Kurs
Kursgruppe
Name der Person
├── Einheit 1
│   ├── Aufgabe 1
│   └── Aufgabe 2
```

Ein Klick auf eine Aufgabe lädt die neueste Abgabe der Person und die Musterlösung
herunter.

### Repositorys von Studierenden klonen

1. Klappe die Aufgabe der Person auf
2. Klicke an ihrem Repository-Ordner auf das **Cloud-Download**-Symbol
   - Oder Rechtsklick → `Repository der Person klonen`
3. Das Repository wird mit dem neuesten Stand der Person geklont

**Hinweis**: Dafür müssen Zugriffstokens für die Repositorys eingerichtet sein. Siehe [Repository-Tokens verwalten](#repository-tokens-verwalten).

### Repositorys von Studierenden aktualisieren

Hat eine Person seit dem Klonen neue Commits gemacht:
1. Klicke auf das **Sync**-Symbol
   - Oder Rechtsklick → `Repository der Person aktualisieren`
2. Die neuesten Änderungen werden geholt

### Studierende bewerten

1. Suche die Aufgabe der Person
2. Klicke auf das Bewertungssymbol oder klicke mit der rechten Maustaste auf die Aufgabe und wähle `Bewerten…`
3. Gib die Bewertung ein, eine Zahl zwischen 0.00 und 1.00
4. Wähle den Bewertungsstatus (`Bewertet`, `Korrektur nötig`,
   `Verbesserung möglich` oder `Nicht bewertet`)
5. Bei einem Korrekturstatus öffnet sich die Unterhaltung, damit du der
   Person sagen kannst, was sie ändern soll

### Mit der Musterlösung vergleichen

So vergleichst du die Arbeit einer Person mit der Musterlösung:
1. Klappe die Aufgabe auf; die Musterlösung findest du unter dem gleichnamigen Eintrag
2. Rechtsklick auf eine Datei unter **Abgaben** → `Mit Musterlösung vergleichen`
3. Es öffnet sich ein Vergleich mit derselben Datei in der Musterlösung

### Rückmeldung geben

- **Nachrichten**: Rechtsklick → `Nachrichten anzeigen`, um Nachrichten zu schreiben
- **Kommentare**: Rechtsklick auf die Person → `Kommentare anzeigen` für nicht öffentliche Notizen
- **Bewertungen**: Für die offizielle Rückmeldung verwendest du die Bewertungsfunktion

### Repository-Tokens verwalten

Tutor:innen brauchen persönliche GitLab-Zugriffstokens (Personal Access Tokens, PAT), um Repositorys von Studierenden zu klonen.

1. Befehl: `Computor: Repository-Tokens verwalten`
2. Wähle eine GitLab-Instanz aus oder wähle **Add New GitLab Instance** und gib ihre URL ein
   (z. B. `https://gitlab.example.com`)
3. Wähle bei einer bekannten Instanz **Update Token**, **Remove Token** oder **Test Token**
4. Gib dein persönliches GitLab-Zugriffstoken ein
5. Die Tokens werden sicher gespeichert und automatisch verwendet

**Ein GitLab-PAT erstellen**:
- Gehe in deiner GitLab-Instanz zu Settings → Access Tokens
- Erstelle ein Token mit dem Geltungsbereich `read_repository`
- Kopiere es und füge es in Computor ein

---

## Leitfaden für Lehrende

Als Lehrende:r kannst du Kurse, Kursinhalte und Beispiele anlegen und verwalten und den gesamten Lehrbetrieb im Blick behalten.

### Kursverwaltung

#### Kurse ansehen

Der Baum der Lehrenden-Ansicht zeigt deine organisatorische Struktur:
```
Organisation
├── Kursfamilie
│   ├── Kurs
│   │   ├── 📂 Inhalte
│   │   ├── 📊 Inhaltstypen
│   │   └── 👥 Gruppen
```

#### Kursinhalte anlegen

1. Rechtsklick auf `Inhalte` (oder auf eine Einheit) → `Einheit anlegen` oder `Aufgabe anlegen`
2. Gib die Angaben zum Inhalt ein:
   - Titel
   - Inhaltstyp
3. Der Inhalt wird angelegt

Inhalte lassen sich verschachteln (hierarchische Struktur).

#### Inhaltstypen anlegen

Inhaltstypen legen fest, um welche Art von Arbeit es sich handelt:

1. Rechtsklick auf `Inhaltstypen` → `Inhaltstyp anlegen`
2. Lege Folgendes fest:
   - Art des Inhalts (mit oder ohne Abgabe)
   - Name (z. B. „Hausübung“, „Labor“, „Prüfung“)
   - Farbe (optional)
3. Verwende diesen Typ, wenn du Kursinhalte anlegst

#### Kursgruppen anlegen

Gruppen gliedern die Studierenden:

1. Rechtsklick auf `Gruppen` → `Kursgruppe anlegen`
2. Gib den Namen der Gruppe ein
3. Studierende können den Gruppen zugeordnet werden

#### Kursinhalte verwalten

- **Titel ändern**: Rechtsklick → `Titel ändern…`
- **Löschen**: Rechtsklick → `Löschen`
- **Typ ändern**: Rechtsklick → `Inhaltstyp ändern`
- **Details ansehen**: Rechtsklick → `Details anzeigen`

### Beispiel-Repository verwalten

Beispiele sind wiederverwendbare Aufgabenvorlagen, die in einem zentralen Repository liegen.

#### Beispiele ansehen

Die Ansicht **Beispiele** zeigt alle verfügbaren Beispiele:
```
Beispiel-Repository
├── Kategorie 1
│   ├── Beispiel A
│   └── Beispiel B
```

#### Beispiele suchen und filtern

Verwende die Symbole in der Symbolleiste:
- **🔍 Beispiele durchsuchen**: Suche nach Titel, Kennung oder Schlagwörtern
- **🏷️ Nach Schlagwörtern filtern**: Wähle mehrere Schlagwörter aus
- **📂 Nach Kategorie filtern**: Wähle eine Kategorie aus
- **❌ Suche zurücksetzen**, **Kategoriefilter zurücksetzen** oder **Schlagwortfilter zurücksetzen** (an der Zeile eines aktiven Filters unter **Filter**): Setzt diesen Filter zurück

#### Beispiele auschecken

1. Suche das Beispiel im Baum
2. Rechtsklick → `Neueste Version auschecken` (oder `Version auschecken…` für eine ältere Version)
3. Das Beispiel wird in deinen Arbeitsbereich heruntergeladen

Verwandte Befehle:
- **Neueste Versionen auschecken (gefiltert)**: Lädt alle gerade sichtbaren Beispiele herunter
- **Mehrere Beispiele auschecken** (Befehlspalette): Ist noch nicht umgesetzt; der Befehl weist nur darauf hin

#### Beispiele hochladen

**Ein vorhandenes Beispiel hochladen (nach Änderungen)**:
1. Ändere ein ausgechecktes Beispiel
2. Rechtsklick auf das Beispiel → `Beispiel hochladen`
3. Die aktualisierte Version wird hochgeladen

**Als neues Beispiel hochladen**:
1. Führe in der Befehlspalette `Computor-Beispiele: Als neues Beispiel hochladen` aus
2. Wähle in deinem Arbeitsbereich die `meta.yaml` des Beispiels aus
3. Wähle das Beispiel-Repository aus, in das hochgeladen werden soll

**Aus einer ZIP-Datei hochladen**:
1. Rechtsklick auf die oberste Zeile des Beispiel-Repositorys → `Beispiele aus ZIP-Datei hochladen`
2. Wähle eine ZIP-Datei aus, die ein oder mehrere Beispiele enthält
3. Jeder Unterordner wird zu einem eigenen Beispiel

#### Kursinhalte aus Beispielen anlegen

So verknüpfst du ein Beispiel mit einem Kursinhalt:

1. Rechtsklick auf ein Beispiel → `Aufgabe im Kurs anlegen`
2. Wähle den Zielkurs aus
3. Wähle den übergeordneten Inhalt (oder die oberste Ebene) aus
4. Gib die Angaben zur Aufgabe ein
5. Die Aufgabe wird angelegt und mit dem Beispiel verknüpft

Einem vorhandenen Inhalt weist du ein Beispiel zu, indem du es aus der Ansicht
Beispiele auf die Aufgabe im Kursbaum ziehst.

#### Dateien von Beispielen verwalten

Wenn du die Dateien eines Beispiels ansiehst:
- **Umbenennen**: Rechtsklick → `Umbenennen`
- **Löschen**: Rechtsklick → `Löschen`
- **Im Explorer anzeigen**: Zeigt die Datei im Explorer von VS Code

### Kursinhalte freigeben

Studierende sehen Inhalte erst, wenn sie freigegeben sind:

1. Rechtsklick auf den Kurs, seinen Ordner `Inhalte` oder einen bestimmten Inhalt → `Inhalt freigeben`
2. Die Freigabe umfasst die angeklickte Zeile, also den ganzen Kurs oder diesen Inhalt
3. Der Inhalt wird für die Studierenden sichtbar

### Fortschritt der Studierenden ansehen

- **Nachrichten**: Rechtsklick → `Nachrichten anzeigen`, um Diskussionen zu sehen
- **Kommentare zu Teilnehmenden**: Rechtsklick → `Kommentare anzeigen` für Notizen zu Studierenden
- **Remote-Repository öffnen**: Rechtsklick auf den Kurs → `Remote-Repository öffnen`

### Dateien von Aufgaben

Die Dateien einer Aufgabe stammen aus dem ihr zugewiesenen Beispiel. Du bearbeitest
sie deshalb in der Ansicht Beispiele (Beispiel auschecken, bearbeiten, neue Version
hochladen) und gibst den Inhalt anschließend für die Studierenden frei. Im Kursbaum
lassen sich keine Dateien anlegen: Er kann dir nur eine lokale Kopie des
Aufgaben-Repositorys zeigen. Sie wird nur vom Server aktualisiert und nie zurückgeschrieben,
sodass nichts, was du hineinschreibst, die Studierenden erreicht.

Aufgaben sind die untersten Einträge im Kursbaum und lassen sich nicht aufklappen. Was für eine
Aufgabe gerade bereitgestellt ist, siehst du über Rechtsklick auf die Aufgabe →
`Bereitgestellte Dateien anzeigen`.

### Grenzen für Testläufe und Abgaben

Klicke mit der rechten Maustaste auf eine Aufgabe und wähle
`Höchstzahl der Testläufe festlegen…` oder `Höchstzahl der Abgaben festlegen…`, oder
bearbeite beide Werte unter `Details anzeigen`. Bleibt das Feld leer, gibt es keine Begrenzung; `0` bedeutet, dass
die Studierenden keinen Versuch haben.

### Dokumente

Die Ansicht **Dokumente** enthält das Material, das den Studierenden unter `/docs`
bereitgestellt wird: Foliensätze, Handouts und Datendateien, auf die Aufgaben
verweisen. Sie bildet den Kursbaum nach, also Organisation → Kursfamilie → Kurs, und
jede dieser Ebenen hat ihre eigenen Dokumente.

**Wo was liegt.** Dokumente liegen auf dem Server. Dein Arbeitsbereich behält eine
Kopie derjenigen, die du geöffnet hast, weshalb jede Zeile anzeigt, wie sich beide
zueinander verhalten: Ohne Markierung stimmen sie überein, `· auf dem Server` bedeutet,
dass du noch keine Kopie hast (ein Klick holt sie), `● hier geändert`, dass deine Kopie
abweicht, `● nicht veröffentlicht`, dass das Dokument nur in deinem Arbeitsbereich
existiert, und `⟳ neuer auf dem Server`, dass jemand anderes inzwischen eine neuere Fassung hochgeladen hat.

**Ansehen.** Bilder, PDF- und HTML-Dokumente werden im Editor dargestellt. Alles andere
öffnet sich in dem Editor, den VS Code dafür vorsieht.

**Dateien herausholen.** Klicke mit der rechten Maustaste auf ein Dokument, einen Ordner oder einen ganzen Kurs
und wähle `Auf meinen Computer herunterladen…`. Ordner kommen als ZIP-Datei an. So
gelangen die Dateien auf den Rechner, an dem du sitzt, während `Herunterladen` sie nur
in deinen Arbeitsbereich holt.

**Dateien hineinbringen.** Klicke mit der rechten Maustaste auf einen Ordner oder Kurs und wähle
`Dateien von meinem Computer hochladen…` oder `Ordner von meinem Computer hochladen…`. Diese Befehle
sind für den Fall gedacht, dass die Quelle auf deinem Laptop liegt, etwa eine
PowerPoint- oder Keynote-Datei, die nie auf dem Server war. Das Hochladen veröffentlicht
sofort; einen eigenen Freigabeschritt gibt es nicht.

**Aus einer Aufgabe verlinken.** Rechtsklick → `Öffentliche URL kopieren` liefert die
Adresse, unter der das Dokument bereitgestellt wird.

**Wer was ändern darf.** Für Kursdokumente brauchst du in dem betreffenden Kurs
mindestens die Rolle Lehrende, für Dokumente auf Ebene von Kursfamilie und Organisation
mindestens die Rolle Bearbeitung, und Systemdokumente sind Administrator:innen
vorbehalten.

**Löschen.** Löschen lässt sich nicht rückgängig machen, denn es gibt weder einen Verlauf noch einen Papierkorb, und
andere Aufgaben verweisen möglicherweise auf das, was du entfernst. Deshalb musst du
beim Löschen eines Ordners dessen Namen eintippen.

---

## Häufige Aufgaben

### Verbindung zum Backend prüfen

So prüfst du die Verbindung zum Backend:

1. Befehl: `Computor: Verbindung zum Backend prüfen`
2. Das Ergebnis zeigt:
   - den Status des Backends
   - den Status der Anmeldung
   - Angaben zum Benutzerkonto

### Nachrichten ansehen

Nachrichten dienen Ankündigungen und Diskussionen:

1. Rechtsklick auf einen beliebigen Kurs oder Inhalt
2. Wähle `Nachrichten anzeigen`
3. Es öffnet sich eine Ansicht mit dem Nachrichtenverlauf
4. Du kannst neue Nachrichten schreiben und antworten

### Einstellungen

So öffnest du die Einstellungen der Erweiterung:

1. Befehl: `Computor: Einstellungen`
2. Lege Folgendes fest:
   - Backend-URL (Abschnitt **Server-Adresse**)
   - Name und E-Mail-Adresse für Git (Abschnitt **Git-Einrichtung**)
   - Tokens der Repository-Anbieter (Abschnitt **Git-Anbieter**)

---

## Fehlerbehebung

### Probleme bei der Anmeldung

**Problem**: „Die Anmeldung wurde nicht abgeschlossen“ oder „Die Anmeldung ist fehlgeschlagen“

**Lösungen**:
- Prüfe, ob die Backend-URL stimmt (`Computor: Backend-URL ändern`)
- Schließe die Anmeldung in dem Browserfenster ab, das `Computor: Anmelden` öffnet
- Stelle sicher, dass das Backend erreichbar ist (probiere es im Browser aus)
- In einem gehosteten oder entfernten Arbeitsbereich steht die Anmeldung über den Browser nicht zur
  Verfügung: Starte den Arbeitsbereich aus der Computor-Web-App neu oder verwende `Computor: Mit API-Token anmelden`

### Klonen eines Repositorys schlägt fehl

**Problem**: „Das Repository konnte nicht geklont werden“

**Lösungen**:
- **Studierende**: Stelle sicher, dass du Zugriff auf den Kurs hast
- **Tutor:innen**: Prüfe, ob GitLab-Tokens eingerichtet sind (`Repository-Tokens verwalten`)
- Prüfe, ob Git installiert ist (`git --version` im Terminal)
- Prüfe die Netzwerkverbindung zu GitLab

### Probleme mit GitLab-Tokens

**Problem**: „Authentication failed“ beim Klonen von Repositorys der Studierenden

**Lösungen**:
- Führe `Computor: Repository-Tokens verwalten` aus
- Stelle sicher, dass das Token zur richtigen GitLab-Instanz gehört
- Prüfe, ob das Token den Geltungsbereich `read_repository` oder `write_repository` hat
- Prüfe in GitLab, ob das Token nicht abgelaufen ist

### Testlauf schlägt fehl

**Problem**: Tests laufen nicht oder zeigen Fehler

**Lösungen**:
- Stelle sicher, dass das Kurs-Repository eingerichtet ist und das Hochladen funktioniert (kein `⚠` in der Zeile;
  andernfalls führe `Anmeldung am Repository reparieren` am Kurs aus)
- Prüfe die verbleibenden Testläufe, die in der Zeile der Aufgabe angezeigt werden
- Suche in der Testausgabe im Bereich Testergebnisse nach konkreten Fehlern

### Ansichten werden nicht angezeigt

**Problem**: Die Student-, Tutor- oder Lehrenden-Ansicht erscheint nicht

**Lösungen**:
- Melde dich ab und wieder an
- Prüfe, ob dein Konto die passende Rolle hat
- Bitte eine:n Administrator:in, die Rollenzuweisung zu prüfen
- Lade das Fenster von VS Code neu

### Probleme mit der Backend-Verbindung

**Problem**: „Keine Verbindung zu Computor.“

**Lösungen**:
- Prüfe die Backend-URL in den Einstellungen
- Prüfe, ob das Backend läuft
- Teste die Netzwerkverbindung
- Prüfe die Firewall- und Proxy-Einstellungen
- Verwende zur Diagnose `Computor: Verbindung zum Backend prüfen`

### Probleme mit der Arbeitsbereichsmarkierung

**Problem**: Die Erweiterung verlangt immer wieder eine Anmeldung

**Lösungen**:
- Stelle sicher, dass in VS Code ein Ordner geöffnet ist
- Prüfe, ob die Datei `.computor` im Stammverzeichnis des Arbeitsbereichs vorhanden ist
- Melde dich erneut an, um die Datei neu anzulegen
- Stelle sicher, dass du im Arbeitsbereichsordner Schreibrechte hast

### Leistungsprobleme

**Problem**: Die Erweiterung ist langsam oder reagiert nicht

**Lösungen**:
- Leere den Cache der Erweiterung (starte VS Code neu)
- Verringere die Zahl der geöffneten Repositorys
- Prüfe die Leistung des Backend-Servers
- Deaktiviere Ansichten, die du nicht brauchst

### Hochladen eines Beispiels schlägt fehl

**Problem**: „Hochladen fehlgeschlagen“

**Lösungen**:
- Stelle sicher, dass die Ordnerstruktur gültig ist
- Prüfe, ob die erforderlichen Dateien vorhanden sind (z. B. `meta.yaml`)
- Prüfe, ob die Dateien nicht zu groß sind
- Suche in den Backend-Protokollen nach konkreten Fehlern

---

## Tastenkombinationen

Alle Aktionen der Erweiterung erreichst du über die Befehlspalette von VS Code. Der übliche Ablauf:

1. `Strg+Umschalt+P` (macOS: `Cmd+Umschalt+P`) – Befehlspalette öffnen
2. `Computor:` eingeben, um alle verfügbaren Befehle zu sehen
3. Den gewünschten Befehl auswählen

Häufig verwendeten Befehlen kannst du eigene Tastenkombinationen zuweisen:

1. Datei → Einstellungen → Tastenkombinationen
2. Suche nach `Computor`
3. Füge die gewünschte Tastenkombination hinzu

---

## Tipps und bewährte Vorgehensweisen

### Für Studierende
- **Sichere häufig**: Sichere deine Arbeit oft, nicht erst kurz vor der Abgabe
- **Teste zuerst**: Führe vor dem Abgeben immer die Tests aus
- **Lies die Nachrichten**: Achte auf Ankündigungen von Lehrenden und Tutor:innen
- **Stelle Fragen**: Über das Nachrichtensystem erreichst du deine Lehrenden

### Für Tutor:innen
- **Nutze Filter**: Filtere die Studierenden, um dich auf bestimmte Gruppen oder Aufgaben zu konzentrieren
- **Vergleiche mit der Musterlösung**: Stelle die Arbeit der Studierenden der Musterlösung gegenüber
- **Gib ausführliche Rückmeldungen**: Verwende sowohl Bewertungen als auch Kommentare
- **Bewerte gebündelt**: Mit Filtern bewertest du mehrere Studierende effizient

### Für Lehrende
- **Nutze Beispiele**: Lege wiederverwendbare Beispiele für häufige Aufgabentypen an
- **Gliedere mit Gruppen**: Ordne die Studierenden über Kursgruppen
- **Gib schrittweise frei**: Gib Inhalte im Laufe des Kurses nach und nach frei
- **Behalte den Fortschritt im Blick**: Sieh regelmäßig die Abgaben und Nachrichten der Studierenden durch
- **Nutze Inhaltstypen**: Lege für unterschiedliche Prüfungsformen klar abgegrenzte Inhaltstypen fest

---

## Hilfe erhalten

- **Lies diese Dokumentation**: Die häufigsten Fragen werden hier beantwortet
- **Wende dich an deine Administration**: bei Fragen zu Konto oder Zugriff
- **Fehler melden**: Klicke in der Statusleiste auf **Problem melden** oder führe `Computor: Problem melden` aus. Es öffnet sich ein Formular, in dem du das Problem beschreibst; das Backend leitet es für dich an die Entwickler:innen weiter, und dein Name erscheint nicht in der Fehlermeldung. Ein Screenshot ist freiwillig und wird nie automatisch aufgenommen: Erstelle ihn selbst, schneide alles Persönliche weg und füge ihn dann in das Formular ein oder ziehe ihn hinein. Alles, was du schreibst oder anhängst, wird Teil der Fehlermeldung, lass also Namen, E-Mail-Adressen, Matrikelnummern und Noten weg. Die Schaltfläche erscheint nur in Installationen, in denen die Problemmeldung eingerichtet ist.
- **Funktionswünsche**: Schlage Verbesserungen über deine Organisation vor

---

## Anhang: Dateistruktur

### Struktur des Arbeitsbereichs

Wenn du Computor verwendest, könnte dein Arbeitsbereich so aussehen:

```
my-workspace/
├── .computor                    # Markierungsdatei der Erweiterung
├── student/                     # Kurs-Repositorys, eines je Kurs
│   └── <Kurs-Repository>/
│       ├── assignment-1/
│       └── assignment-2/
├── review/                      # Tutor:innen: heruntergeladene Abgaben und Musterlösungen
└── examples/                    # Ausgecheckte Beispiele
    ├── example-sorting/
    └── example-graphs/
```

### .computor-Markierungsdatei

Die Datei `.computor` speichert die Einstellungen des jeweiligen Arbeitsbereichs:

```json
{
  "backendUrl": "http://localhost:8000"
}
```

Diese Datei wird bei der ersten Anmeldung automatisch angelegt.

### meta.yaml (Metadaten eines Beispiels)

Beispiele können eine Datei `meta.yaml` mit Metadaten enthalten:

```yaml
title: Sortieralgorithmen
category: Algorithmen
keywords:
  - sorting
  - quicksort
  - mergesort
description: Implementierung gängiger Sortieralgorithmen
```

Diese Datei wird verwendet, wenn du Beispiele in das Repository hochlädst.
