# Kurse

Ein Kurs umfasst alles, wofür du in einer Lehrveranstaltung angemeldet bist:
ihre Einheiten, ihre Aufgaben und das Repository, in dem deine Arbeit liegt. Er
bildet die oberste Zeile in der Ansicht „Kurse“ von Computor, und das meiste, was
diese Seite beschreibt, gilt für alles, was darunter liegt.

```
📖 Programmieren in der Physik
├── ⚫ Woche 1 — Einführung
│   ├── 🟦 Übung 1
│   └── 🟦 Hausübung 1
└── 🟦 Abschlussprojekt
```

Mit einem Klick auf eine Zeile klappst du sie auf. Die Gliederung legen deine
Lehrenden fest; du selbst kannst sie nicht ändern.

## Deine Arbeit liegt in einem einzigen Repository

Jede Aufgabe eines Kurses ist ein Ordner in einem **einzigen Repository**, das
dir gehört. Das solltest du als Erstes verstehen, weil sich fast alles andere
daraus ergibt:

- Wenn du eine Datei speicherst, änderst du sie **nur auf deinem Computer**.
- **Sichern (Commit)** hält deine Änderungen im Repository fest und lädt sie auf
  den Server hoch. Das ist deine Sicherungskopie, und genau das sehen deine
  Lehrenden.
- **Abgeben** ist ein eigener, bewusster Schritt, mit dem du eine Aufgabe zur
  Bewertung einreichst. Ein Commit ist keine Abgabe.

Da das Repository den ganzen Kurs enthält, sichert *Kurs sichern (Commit)* an der
Kurszeile in einem Schritt alles, woran du irgendwo im Kurs gearbeitet hast. Die
entsprechende Aktion an einer einzelnen Aufgabe tut dasselbe nur für deren
Ordner.

Einrichten musst du das Repository normalerweise nie selbst. Es wird angelegt
und heruntergeladen, wenn du den Kurs zum ersten Mal öffnest, und erneut, wenn
die Erweiterung startet.

## Die Markierungen in einer Zeile

Kleine Markierungen in den Zeilen zeigen dir, wie es um deine Arbeit steht. Sie
erscheinen an den Aufgaben, an den Einheiten darüber und an der Kurszeile
selbst:

| Markierung | Bedeutung |
|------------|-----------|
| `●` | Du hast Änderungen, die noch nicht gesichert (committet) sind |
| `↑` | Gesichert, aber noch nicht auf den Server hochgeladen |
| `⚠` | Hoch- oder Herunterladen schlägt fehl — siehe *Anmeldung am Repository reparieren* |

An der Kurszeile trägt das `↑` eine Zahl (`↑3`), die angibt, wie viele Commits
noch auf das Hochladen warten. Eine Zeile ohne Markierung ist gesichert und
hochgeladen, deine Arbeit also in Sicherheit.

Ein `🔔` mit einer Zahl steht für ungelesene Nachrichten.

## Aktionen am Kurs

Klicke mit der rechten Maustaste auf die Kurszeile. Die Symbole in der Zeile
sind Abkürzungen zu denselben Aktionen, und Einträge, die für deinen Kurs nicht
in Frage kommen, werden ausgeblendet, statt angezeigt und dann verweigert zu
werden.

### Kurs sichern (Commit)

Sichert **deine gesamte** Arbeit im Kurs und lädt sie in einem Schritt hoch.
Verwende diese Aktion am Ende einer Arbeitssitzung, bevor du den Arbeitsbereich
schließt, oder wann immer du deine Arbeit sicher auf dem Server haben willst.

### Repository aus Kursvorlage aktualisieren

Bringt dein Repository auf den Stand des Kursmaterials und **stellt jede Datei
wieder her, die du gelöscht hast**.

Selbst ausführen musst du diese Aktion selten: Freigegebene Aktualisierungen
kommen von allein an, wenn der Arbeitsbereich startet und wenn die Kursansicht
neu geladen wird. Mit dieser Aktion stößt du denselben Abgleich von Hand an, wenn
du nicht warten willst.

Dabei geschehen zwei Dinge:

1. Neues und geändertes Material, das deine Lehrenden freigegeben haben, wird in
   dein Repository übernommen.
2. Jede Datei, die im Kursmaterial vorhanden ist, in deinem Ordner aber **nicht**,
   wird wiederhergestellt. Dateien, die du noch hast, bleiben genau so, wie sie
   sind — deine eigene Arbeit wird nie überschrieben.

Mit diesem zweiten Schritt machst du einen Fehler rückgängig. Wenn du eine
Datendatei, eine Abbildung oder eine Ausgangsdatei verdorben hast, **lösche sie**
und führe diese Aktion aus: Du bekommst eine frische Kopie zurück.

> **Kopiere die Datei zuerst**, wenn du behalten willst, was du geschrieben hast.
> Rechtsklick auf die Datei → *Datei kopieren…*, danach löschst du das Original.

### Nachrichten anzeigen

Kursankündigungen enthalten Neuigkeiten, Termine und Klarstellungen der
Lehrenden. Du kannst sie hier lesen; Ankündigungen veröffentlichen dürfen nur
Lehrende und Personen mit weitergehenden Rechten.

Mit [Frage zum Kurs stellen](command:computor.student.askCourseQuestion) öffnest
du deine Unterhaltung mit dem Lehrteam zu dem Kurs, dessen Hilfe du geöffnet
hast. Für eine Frage zu einer bestimmten Übung verwendest du stattdessen
*Nachrichten anzeigen* an der betreffenden Aufgabe.

### Kursaufgaben exportieren

Packt die Aufgaben, die du auf deinem Rechner hast, in eine einzige ZIP-Datei,
damit dir deine Arbeit bleibt, wenn der Kurs endet und dein Zugriff auf das
Repository erlischt. Den Aufbau des Archivs wählst du selbst:

- ***Baum*** — bildet die Kursgliederung nach, die Ordner tragen die Titel der
  Inhalte
- ***Flach*** — ein Ordner je Aufgabe, benannt nach der Kennung ihres Beispiels

Im Browser wird das Archiv in deinem Arbeitsbereich unter `exports/` gespeichert
und anschließend auf deinen Computer heruntergeladen. Blockiert dein Browser den
Download, verwende die Schaltfläche *Download again* auf der Seite, die sich
öffnet, oder klicke die Datei im Explorer mit der rechten Maustaste an und wähle
*Herunterladen…* (in englischem VS Code *Download…*). In der Desktop-Version von VS Code wirst du gefragt, wo die Datei
gespeichert werden soll.

### Außerhalb des Arbeitsbereichs arbeiten

Die Kursseite auf der Website (Kurs öffnen, dann *Check access* unter
*Your repository*) gibt dir einen fertigen `git clone`-Befehl zum Einfügen, der
dein persönliches Zugriffstoken enthält. Damit erhältst du ein **vollständiges
Git-Repository** auf deinem eigenen Computer: Du kannst mit diesem Token aus
jedem Git-Programm Aktualisierungen holen und deine Arbeit hochladen. Das Token
wirkt wie ein Passwort, also behandle es auch so. Es bleibt eigenständig gültig
und ist nicht die Zugangsberechtigung, die der Arbeitsbereich verwaltet.

Das unterscheidet sich von *Kursaufgaben exportieren* oben: Der Export ist eine
schlichte ZIP-Datei mit den Dateien, ohne Git, gedacht, um deine Arbeit über den
Kurs hinaus aufzubewahren. Der Klon bleibt mit dem Kurs verbunden. So oder so
bleibt der Arbeitsbereich der unterstützte Ort zum Arbeiten — getestet und
abgegeben wird dort.

### Anmeldung am Repository reparieren

Erneuert die Zugangsdaten, die dein Repository verwendet. Setze diese Aktion
ein, wenn das Hochladen plötzlich fehlschlägt und die Kurszeile `⚠` zeigt. Deine
Dateien bleiben dabei unberührt.

### Repository einrichten

Legt dein Repository an und lädt es herunter. **Normalerweise brauchst du das
nie** — es geschieht von selbst. Der Eintrag erscheint nur, solange es vom Kurs
noch keine lokale Kopie gibt, etwa wenn du in einen anderen Arbeitsordner
gewechselt bist oder der erste Versuch fehlgeschlagen ist.

### Kursvorlage herunterladen

Für Kurse, deren Material als einfacher Download statt als Repository ausgegeben
wird: Lädt das Material als ZIP-Datei herunter oder entpackt es in einen Ordner
deiner Wahl. Das Material wird auch automatisch geholt, wenn du einen solchen
Kurs zum ersten Mal öffnest; diese Aktion brauchst du, wenn du eine zweite Kopie
an einem anderen Ort haben willst.

## Wenn etwas nicht stimmt

- **Eine Zeile zeigt `⚠`** — führe *Anmeldung am Repository reparieren* am Kurs
  aus.
- **Neues Material ist nicht angekommen** — führe *Repository aus Kursvorlage
  aktualisieren* aus.
- **Du hast etwas gelöscht, das du brauchst** — siehe dieselbe Aktion; gerade das
  Löschen der Datei sorgt dafür, dass eine frische Kopie zurückkommt.
- **Die Baumansicht wirkt veraltet** — klappe den Kurs zu und wieder auf; dadurch
  wird er neu vom Server geladen.

## Weiter

- [Einheiten](student-unit_de.md) — wie ein Kurs gegliedert ist, und Lesematerial
- [Aufgaben](student-assignment_de.md) — bearbeiten, testen, abgeben, Dateien
