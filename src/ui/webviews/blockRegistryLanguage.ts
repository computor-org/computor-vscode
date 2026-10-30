/**
 * German display texts for the bundled test block registry
 * (src/data/block-registry.json), which is English only. Ids, field names and
 * enum values stay as they are; they are what test.yaml stores.
 */

const GERMAN: Record<string, string> = {
  // Test type and comparison names
  'Average Sentence Length': 'Durchschnittliche Satzlänge',
  'Average Word Length': 'Durchschnittliche Wortlänge',
  'Character Count': 'Zeichenanzahl',
  'Code Block Count': 'Anzahl der Codeblöcke',
  'Compilation': 'Kompilierung',
  'Contains': 'Enthält',
  'Contains Line': 'Enthält Zeile',
  'Count Occurrences': 'Vorkommen zählen',
  'Ends With': 'Endet mit',
  'Error': 'Fehler',
  'Exit Code': 'Exit-Code',
  'File Exists': 'Datei vorhanden',
  'Graphics': 'Grafik',
  'Heading Count': 'Anzahl der Überschriften',
  'Image Count': 'Anzahl der Bilder',
  'Keyword': 'Schlüsselwort',
  'Line Count': 'Zeilenanzahl',
  'Link Count': 'Anzahl der Links',
  'Linting': 'Stilprüfung',
  'List Item Count': 'Anzahl der Listeneinträge',
  'Matches': 'Stimmt überein',
  'Matches Line': 'Zeile stimmt überein',
  'Multiline Regex': 'Mehrzeiliger regulärer Ausdruck',
  'Numeric Output': 'Numerische Ausgabe',
  'Paragraph Count': 'Anzahl der Absätze',
  'Pattern': 'Muster',
  'Regular Expression': 'Regulärer Ausdruck',
  'Runtime': 'Laufzeit',
  'Section': 'Abschnitt',
  'Sentence Count': 'Anzahl der Sätze',
  'Standard Error': 'Standardfehlerausgabe',
  'Standard Output': 'Standardausgabe',
  'Starts With': 'Beginnt mit',
  'Structural': 'Struktur',
  'Unique Words': 'Verschiedene Wörter',
  'Variable': 'Variable',
  'Verify Equal': 'Gleichheit prüfen',
  'Warning': 'Warnung',
  'Word Count': 'Wortanzahl',
  // Categories
  'comparison': 'Vergleich',
  'compilation': 'Kompilierung',
  'content': 'Inhalt',
  'metric': 'Kennzahl',
  'numeric': 'Numerisch',
  'output': 'Ausgabe',
  'pattern': 'Muster',
  'quality': 'Qualität',
  'structural': 'Struktur',
  'structure': 'Aufbau',
  'variable': 'Variable',
  // Descriptions
  'Absolute tolerance for numeric comparison': 'Absolute Toleranz für den numerischen Vergleich',
  'Allowed occurrence count [min, max]': 'Erlaubte Anzahl der Vorkommen [min, max]',
  'Check Julia console output': 'Prüft die Ausgabe der Julia-Konsole',
  'Check Julia variable values': 'Prüft Werte von Julia-Variablen',
  'Check R console output': 'Prüft die Ausgabe der R-Konsole',
  'Check R variable values': 'Prüft Werte von R-Variablen',
  'Check average sentence length (words per sentence)': 'Prüft die durchschnittliche Satzlänge (Wörter pro Satz)',
  'Check average word length': 'Prüft die durchschnittliche Wortlänge',
  'Check code structure': 'Prüft den Aufbau des Codes',
  'Check code structure (keywords, functions)': 'Prüft den Aufbau des Codes (Schlüsselwörter, Funktionen)',
  'Check code style with flake8/pylint': 'Prüft den Codestil mit flake8/pylint',
  'Check command window output': 'Prüft die Ausgabe im Befehlsfenster',
  'Check document character count': 'Prüft die Zeichenanzahl des Dokuments',
  'Check document line count': 'Prüft die Zeilenanzahl des Dokuments',
  'Check document paragraph count': 'Prüft die Anzahl der Absätze im Dokument',
  'Check document sentence count': 'Prüft die Anzahl der Sätze im Dokument',
  'Check document structure (patterns, keywords)': 'Prüft den Aufbau des Dokuments (Muster, Schlüsselwörter)',
  'Check document word count': 'Prüft die Wortanzahl des Dokuments',
  'Check execution time/memory': 'Prüft Laufzeit und Speicherbedarf',
  'Check for expected compiler/runtime warnings': 'Prüft auf erwartete Warnungen von Compiler oder Laufzeit',
  'Check for expected errors': 'Prüft auf erwartete Fehler',
  'Check for expected errors in Julia output': 'Prüft die Julia-Ausgabe auf erwartete Fehler',
  'Check for expected errors in R output': 'Prüft die R-Ausgabe auf erwartete Fehler',
  'Check for expected runtime errors': 'Prüft auf erwartete Laufzeitfehler',
  'Check for expected warnings': 'Prüft auf erwartete Warnungen',
  'Check for expected warnings in Julia output': 'Prüft die Julia-Ausgabe auf erwartete Warnungen',
  'Check for expected warnings in R output': 'Prüft die R-Ausgabe auf erwartete Warnungen',
  'Check for keyword presence/frequency': 'Prüft, ob und wie oft Schlüsselwörter vorkommen',
  'Check for regex pattern matches': 'Prüft auf Treffer eines regulären Ausdrucks',
  'Check for required markdown sections/headings': 'Prüft auf geforderte Markdown-Abschnitte und -Überschriften',
  'Check if document file exists (and optionally not empty)': 'Prüft, ob die Dokumentdatei vorhanden (und auf Wunsch nicht leer) ist',
  'Check if file exists (and optionally not empty)': 'Prüft, ob die Datei vorhanden (und auf Wunsch nicht leer) ist',
  'Check if line exists anywhere in output': 'Prüft, ob die Zeile irgendwo in der Ausgabe vorkommt',
  'Check if output contains substring': 'Prüft, ob die Ausgabe eine Zeichenfolge enthält',
  'Check if output ends with suffix': 'Prüft, ob die Ausgabe mit einer Zeichenfolge endet',
  'Check if output starts with prefix': 'Prüft, ob die Ausgabe mit einer Zeichenfolge beginnt',
  'Check markdown code block count': 'Prüft die Anzahl der Markdown-Codeblöcke',
  'Check markdown heading count': 'Prüft die Anzahl der Markdown-Überschriften',
  'Check markdown image count': 'Prüft die Anzahl der Markdown-Bilder',
  'Check markdown link count': 'Prüft die Anzahl der Markdown-Links',
  'Check markdown list item count': 'Prüft die Anzahl der Markdown-Listeneinträge',
  'Check matplotlib plot/figure properties': 'Prüft Eigenschaften von matplotlib-Plots und -Abbildungen',
  'Check number of output lines': 'Prüft die Anzahl der Ausgabezeilen',
  'Check plot/figure properties': 'Prüft Eigenschaften von Plots und Abbildungen',
  'Check program exit code': 'Prüft den Exit-Code des Programms',
  'Check program stderr': 'Prüft die Fehlerausgabe (stderr) des Programms',
  'Check program stdout': 'Prüft die Standardausgabe (stdout) des Programms',
  'Check unique word count (vocabulary)': 'Prüft die Anzahl verschiedener Wörter (Wortschatz)',
  'Check variable values after execution': 'Prüft Variablenwerte nach der Ausführung',
  'Check workspace variable values': 'Prüft Werte von Variablen im Workspace',
  'Code to run before tests': 'Code, der vor den Tests läuft',
  'Command line arguments': 'Kommandozeilenargumente',
  'Comparison method': 'Vergleichsmethode',
  'Compiler flags': 'Compiler-Optionen',
  'Compiler to use': 'Zu verwendender Compiler',
  'Count occurrences of pattern': 'Zählt die Vorkommen eines Musters',
  'Directory to check in': 'Zu prüfendes Verzeichnis',
  'Document file to analyze': 'Zu analysierende Dokumentdatei',
  "Error codes to ignore (e.g., 'E501,W503')": "Zu ignorierende Fehlercodes (z. B. 'E501,W503')",
  'Exact string match': 'Exakte Übereinstimmung des Texts',
  'Exact value comparison with type checking': 'Exakter Wertvergleich mit Typprüfung',
  'Expect compilation to succeed (true) or fail (false)': 'Erwartet, dass die Kompilierung gelingt (true) oder scheitert (false)',
  'Expected average sentence length (words)': 'Erwartete durchschnittliche Satzlänge (Wörter)',
  'Expected average word length': 'Erwartete durchschnittliche Wortlänge',
  'Expected character count': 'Erwartete Zeichenanzahl',
  'Expected code block count': 'Erwartete Anzahl der Codeblöcke',
  'Expected exit code': 'Erwarteter Exit-Code',
  'Expected heading count': 'Erwartete Anzahl der Überschriften',
  'Expected image count': 'Erwartete Anzahl der Bilder',
  'Expected keyword count': 'Erwartete Anzahl der Schlüsselwörter',
  'Expected line count': 'Erwartete Zeilenanzahl',
  'Expected link count': 'Erwartete Anzahl der Links',
  'Expected list item count': 'Erwartete Anzahl der Listeneinträge',
  'Expected match count': 'Erwartete Anzahl der Treffer',
  'Expected paragraph count': 'Erwartete Anzahl der Absätze',
  'Expected sentence count': 'Erwartete Anzahl der Sätze',
  'Expected unique word count': 'Erwartete Anzahl verschiedener Wörter',
  'Expected value to compare against': 'Erwarteter Wert für den Vergleich',
  'Expected word count': 'Erwartete Wortanzahl',
  'Expression to evaluate for expected value': 'Ausdruck, der den erwarteten Wert liefert',
  'Extract and compare numeric values from output': 'Liest Zahlen aus der Ausgabe und vergleicht sie',
  'File to analyze': 'Zu analysierende Datei',
  'File to lint': 'Datei für die Stilprüfung',
  'For exist tests: if False (default), fail if file is empty (0 bytes)': 'Für Existenztests: Bei False (Standard) schlägt der Test fehl, wenn die Datei leer ist (0 Bytes)',
  'Ignore case when comparing': 'Groß-/Kleinschreibung beim Vergleich ignorieren',
  'Input lines to send to stdin': 'Zeilen, die an stdin gehen',
  'Julia code to run before tests': 'Julia-Code, der vor den Tests läuft',
  'Julia expression to evaluate': 'Auszuwertender Julia-Ausdruck',
  'Line number to check (1-indexed)': 'Zu prüfende Zeilennummer (ab 1 gezählt)',
  'MATLAB/Octave code to run before tests': 'MATLAB/Octave-Code, der vor den Tests läuft',
  'Main file to execute': 'Auszuführende Hauptdatei',
  'Markdown file to analyze': 'Zu analysierende Markdown-Datei',
  'Match against regular expression': 'Abgleich mit einem regulären Ausdruck',
  'Match specific line number': 'Abgleich einer bestimmten Zeilennummer',
  'Maximum execution time in seconds': 'Höchste Ausführungszeit in Sekunden',
  'Multiline regular expression matching': 'Abgleich mit einem mehrzeiligen regulären Ausdruck',
  'Pattern for matching (string or regex)': 'Muster für den Abgleich (Text oder regulärer Ausdruck)',
  'R code to run before tests': 'R-Code, der vor den Tests läuft',
  'R expression to evaluate': 'Auszuwertender R-Ausdruck',
  'Relative tolerance for numeric comparison': 'Relative Toleranz für den numerischen Vergleich',
  'Required heading level (1-6)': 'Geforderte Überschriftenebene (1–6)',
  'Save figure images': 'Abbildungen speichern',
  'Save figure images as artifacts': 'Abbildungen als Artefakte speichern',
  'Test compilation success/failure': 'Prüft, ob die Kompilierung gelingt oder scheitert',
  'Test name (displayed in results)': 'Testname (in den Ergebnissen angezeigt)',
  'Token type to match': 'Abzugleichende Token-Art',
  'Tolerance for numeric comparison': 'Toleranz für den numerischen Vergleich',
  'Trim whitespace from output': 'Leerraum am Rand der Ausgabe entfernen',
  // Placeholders
  'Expected output or value': 'Erwartete Ausgabe oder erwarteter Wert',
  'e.g., Sum: \\d+': 'z. B. Sum: \\d+',
  'e.g., check_sum_result': 'z. B. check_sum_result',
  'e.g., len(result)': 'z. B. len(result)',
  'e.g., main.py': 'z. B. main.py'
};

// Only these keys hold display text; `name` is display text only on test
// types and comparisons, not on fields, where it is the YAML key.
const TEXT_KEYS = new Set(['description', 'placeholder', 'category']);

function translate(value: unknown, key: string, displayName: boolean): unknown {
  if (typeof value !== 'string') { return value; }
  if (TEXT_KEYS.has(key) || (key === 'name' && displayName)) {
    return GERMAN[value] ?? value;
  }
  return value;
}

function walk(node: unknown, displayName: boolean): unknown {
  if (Array.isArray(node)) { return node.map(item => walk(item, displayName)); }
  if (!node || typeof node !== 'object') { return node; }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'example') {
      out[key] = value;
    } else if (key === 'test_types' || key === 'qualifications') {
      out[key] = walk(value, true);
    } else if (key === 'collection_fields' || key === 'test_fields' || key === 'config_fields' || key === 'extra_fields') {
      out[key] = walk(value, false);
    } else if (value && typeof value === 'object') {
      out[key] = walk(value, displayName && key !== 'languages');
    } else {
      out[key] = translate(value, key, displayName);
    }
  }
  return out;
}

/** The registry with its display texts in `language`; English is returned as is. */
export function localizeBlockRegistry<T>(registry: T, language: string): T {
  return language === 'de' ? walk(registry, false) as T : registry;
}
