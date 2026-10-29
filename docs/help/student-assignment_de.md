# Aufgaben

Eine Aufgabe ist eine Arbeit, die du abgibst: ein Ordner in deinem
Kurs-Repository mit der Aufgabenstellung, den Dateien, von denen du ausgehst,
und den Dateien, die du schreiben sollst. Diese Seite erklärt, wie du eine
Aufgabe bearbeitest und abgibst und was du alles mit den Dateien darin tun
kannst.

## Was dir die Zeile verrät

```
🟦 Übung 1: Hello World   ● 🔔 1 (2/5) (1/3) 85% 90%
```

Von links nach rechts gelesen:

| Teil | Bedeutung |
|------|-----------|
| 🟦 | Der Inhaltstyp, den deine Lehrenden festgelegt haben — Übung, Hausübung, Prüfung. Ein Häkchen oder Kreuz auf dem Symbol zeigt, ob der letzte Test bestanden wurde |
| `●` `↑` `⚠` | Der Zustand deiner Arbeit: nicht gesichert, nicht hochgeladen, Hochladen schlägt fehl. Siehe [Kurse](student-course_de.md#die-markierungen-in-einer-zeile) |
| `🔔 1` | Ungelesene Nachrichten zu dieser Aufgabe |
| `(2/5)` | Testläufe: zwei von fünf erlaubten verbraucht. Nur `(2)`, wenn es keine Obergrenze gibt |
| `(1/3)` | Abgaben: eine von drei erlaubten getätigt |
| `85%` | Das **Testergebnis** — was die automatischen Tests ergeben haben |
| `90%` | Die **Bewertung** — die offizielle Note deiner Lehrenden, sobald bewertet wurde |

Die beiden Prozentangaben behalten stets ihren Platz: zuerst das Testergebnis,
dann die Bewertung. Hast du eine Bewertung, aber kein Testergebnis, steht an der
ersten Stelle `-%`, sodass die zweite Zahl immer die Bewertung ist und nie erraten
werden muss.

Fährst du mit der Maus über die Zeile, bekommst du dieselben Angaben in Worten,
bei einer Teamaufgabe zusätzlich die Mitglieder deines Teams.

## Eine Aufgabe bearbeiten

**1. Lies die Aufgabenstellung.** Klicke auf den Titel der Übung oder wähle ihn
mit den Pfeiltasten aus und drücke die Eingabetaste. Ihre Anleitung öffnet sich
neben deinem Code, ohne dass dafür ein Repository eingerichtet wird. Das
Vorschausymbol und Rechtsklick → *Anleitung anzeigen* stehen weiterhin zur
Verfügung. Mit dem Pfeil (Chevron) klappst du die Dateien der Übung auf, sobald
du mit der Arbeit beginnen willst.

**2. Schreibe deine Lösung.** Klappe die Aufgabe auf, um ihre Dateien zu sehen,
und öffne eine davon mit einem Klick. Behalte die Dateien, die die
Aufgabenstellung verlangt, unter den verlangten Namen bei — benennst du eine
Datei um, nach der die Tests suchen, schlagen sie fehl.

**3. Teste.** Klicke auf das Becherglas-Symbol oder wähle Rechtsklick →
*Aufgabe testen*.

> Ein Test ist kein lokaler Probelauf. Computor speichert deine geöffneten
> Dateien, sichert sie mit einem Commit, lädt sie hoch und führt die Tests **auf
> dem Server** aus — ein Testlauf lädt also immer deinen aktuellen Stand hoch und
> verbraucht immer einen deiner Testläufe, falls die Aufgabe eine Obergrenze
> hat. Die Ergebnisse erscheinen im Bereich „Testergebnisse“; ein Klick auf einen
> fehlgeschlagenen Test führt dich zu dem Code, um den es geht.

**4. Sichere zwischendurch.** Das Commit-Symbol an der Aufgabe speichert diesen
Ordner und lädt ihn hoch; *Kurs sichern (Commit)* an der Kurszeile erledigt das
für den ganzen Kurs auf einmal. Sichere früh und oft — das ist deine
Sicherungskopie, und es kostet nichts. Ein Commit ist keine Abgabe, und niemand
bewertet ihn.

**5. Gib ab, wenn du so weit bist.** Das Upload-Symbol oder Rechtsklick →
*Abgeben*. Damit reichst du deine Arbeit bewusst ein; die Zahl der Abgaben ist
begrenzt und kann nur steigen.

Computor gibt den Commit ab, der **getestet** wurde, nicht unbedingt deinen
neuesten. Unterscheiden sich die beiden — etwa weil der letzte Test nicht laufen
konnte —, wirst du darauf hingewiesen, bevor irgendetwas abgegeben wird, sodass
deine neueste Arbeit nie stillschweigend bewertet oder stillschweigend
übergangen wird.

**6. Lies die Rückmeldung.** *Testergebnisse anzeigen* für den automatischen
Testlauf, *Details anzeigen* für den Verlauf deiner Abgaben und die Bewertung,
*Nachrichten anzeigen* für das, was deine Lehrenden oder Tutor:innen geschrieben
haben. Der Status *Korrektur nötig* bedeutet, dass Änderungen erwartet werden;
*Verbesserung möglich* bedeutet, dass du nachbessern darfst, sofern dir noch
Abgaben bleiben.

## Testläufe und Abgaben sind begrenzt

Legen deine Lehrenden eine Obergrenze fest, zeigt die Zeile, wie viel dir noch
bleibt, und Computor weist dich darauf hin, bevor eine Aktion die Grenze
überschreiten würde, nicht erst danach.

Setze Testläufe überlegt ein: Lies die Fehlermeldung, denk über den Code nach und
teste erst dann. Spare Abgaben für Arbeit auf, von der du überzeugt bist —
sobald die Höchstzahl erreicht ist, kannst du nicht mehr abgeben, und daran
ändert auch noch so viel verbleibende Zeit nichts.

## Mit Dateien arbeiten

Klappe eine Aufgabe auf, um ihre Dateien zu sehen. Klicke mit der rechten
Maustaste auf eine Datei, einen Ordner oder die Aufgabe selbst. Alles, was hier
geschieht, geschieht **nur auf deinem Computer** — auf den Server gelangt nichts,
bevor du es sicherst (Commit).

**Anlegen.** *Neue Datei…* und *Neuer Ordner…* an der Aufgabe oder an einem
Ordner. Die neue Datei öffnet sich sofort.

**Kopieren und Verschieben.** *Datei kopieren…* und *Datei verschieben…* bieten
nur Ordner innerhalb derselben Aufgabe an, damit Arbeit nicht versehentlich in
einer anderen Übung landet. Ist der Name schon vergeben, wirst du gefragt, ob du
*Beide behalten* oder *Überschreiben* willst.
*Ausschneiden*, *Kopieren* und *Einfügen* sind die Alternative in zwei Schritten;
*Einfügen* erscheint, sobald etwas zum Einfügen bereitliegt.

**Umbenennen und Duplizieren.** *Umbenennen…* vergibt einen neuen Namen;
*Duplizieren* legt eine Kopie neben dem Original an.

**Löschen.** *Datei löschen* und *Ordner löschen*, stets nach einer Rückfrage.
Gehörte die Datei zu einer Aufgabe, die du bereits abgegeben hast, sagt dir die
Rückfrage das — löschen darfst du sie trotzdem, aber nicht, ohne es zu wissen.
Dieselbe Warnung erscheint, wenn du eine solche Datei verschiebst oder
umbenennst.

Löschst du eine Datei an anderer Stelle — im Explorer oder mit `rm` in einem
Terminal —, lässt sich das nicht vorher abfangen. Computor bemerkt es aber
unmittelbar danach und bietet dir, falls die Datei Teil einer Abgabe war, an,
deine zuletzt gesicherte Fassung mit einem Klick zurückzuholen.

**Pfade.** *Pfad kopieren* liefert den vollständigen Pfad, *Relativen Pfad
kopieren* den Pfad innerhalb des Repositorys, und *Im Dateimanager anzeigen*
zeigt die Datei im Dateimanager — oder, wenn du im Browser arbeitest, im
Explorer von VS Code. Verweigert der Browser Computor den Zugriff auf die
Zwischenablage, wird der Pfad in einem Feld angezeigt, aus dem du ihn von Hand
kopieren kannst.

**Was du nicht ändern kannst.** Einiges wird für dich verwaltet: `.git` sowie auf
der obersten Ebene einer Aufgabe die `README.md`, ihre Übersetzungen und
`mediaFiles` — das ist die Aufgabenstellung, die deine Lehrenden pflegen.
README-Dateien in Unterordnern darfst du selbst schreiben.

## Eine Datei wiederherstellen

Hast du eine Datei verdorben, die zur Aufgabe gehörte — Daten, eine Abbildung,
den Ausgangscode —, kannst du dir eine frische Kopie holen:

1. **Kopiere alles, was du behalten willst** (Rechtsklick → *Datei kopieren…*).
2. **Lösche** die Datei.
3. Rechtsklick auf den **Kurs** → *Repository aus Kursvorlage aktualisieren*.

Jede Datei, die im Kursmaterial vorhanden ist, in deinem Ordner aber nicht, wird
wiederhergestellt, und Dateien, die du noch hast, bleiben unberührt. Deshalb ist
das vorherige Löschen ein notwendiger Schritt und keine Abkürzung: Erst dadurch
ist die Wiederherstellung für alles andere, was du geschrieben hast, gefahrlos.

## Teamaufgaben

Manche Aufgaben werden von einer Gruppe abgegeben. Du teilst dir mit deinen
Teammitgliedern einen Ordner und ein Abgabenkontingent: Jede und jeder von euch
kann committen, und jede und jeder kann für alle abgeben. Der Text, der beim
Überfahren mit der Maus erscheint, nennt die Mitglieder des Teams.

Sprecht ab, wer wann abgibt. Eine Abgabe, die ein Mitglied verbraucht, ist für
alle verbraucht.

## Wenn etwas schiefgeht

**„Ich habe eine Datei gelöscht, die ich brauche.“** Siehe
[Eine Datei wiederherstellen](#eine-datei-wiederherstellen). Hattest du die Datei
gesichert, hat Computor dir womöglich auch gleich nach dem Löschen angeboten,
deine eigene Fassung wiederherzustellen.

**„Die Tests laufen nicht.“** Die Aufgabe muss lokal eingerichtet sein, und deine
Arbeit muss sich hochladen lassen — ein `⚠` in der Zeile bedeutet, dass das
Hochladen fehlschlägt; führe deshalb zuerst *Anmeldung am Repository reparieren*
am Kurs aus. Startet der Lauf, schlagen aber alle Tests fehl, lies die Ausgabe in
„Testergebnisse“, bevor du einen weiteren Versuch verbrauchst.

**„Die Abgabe ist fehlgeschlagen.“** Prüfe die Zahl der Abgaben in der Zeile.
Liegt es nicht daran, achte auf `⚠` — für eine Abgabe muss deine Arbeit auf dem
Server sein.

**„Ich habe keine Testläufe mehr.“** Frag deine Lehrenden in den
Kursnachrichten. Bis dahin gilt dein letztes erfolgreiches Ergebnis weiter, und
abgeben kannst du trotzdem.

**„Meine neueste Arbeit wurde nicht bewertet.“** Beim Abgeben wird der
*getestete* Commit eingereicht. Führe einen Test mit deinem neuesten Commit aus
und gib dann erneut ab, sofern dir noch eine Abgabe bleibt.

## Weiter

- [Kurse](student-course_de.md) — das Repository, Commits und die Markierungen in den Zeilen
- [Einheiten](student-unit_de.md) — wie ein Kurs gegliedert ist, und Lesematerial
