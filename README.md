# ZeroPensieri

Un programma semplice per tenere in ordine i documenti di casa: multe, bollette, assicurazioni, visite mediche, atti.
Pensato per chi non ha confidenza con il computer: tre pulsanti grandi, scritte grandi, niente di superfluo.

![La schermata iniziale di ZeroPensieri: tre grandi pulsanti colorati, Carica documento, I tuoi documenti e Cose da pagare](docs/schermata-home.png)

- **Carica documento** – aggiungi una foto, un PDF o un file Word, scegli la cartella, dì se è da pagare.
- **I tuoi documenti** – sfoglia la cartella collegata con le anteprime.
- **Cose da pagare** – l'elenco di ciò che va pagato, con la scadenza e il tasto **PAGATO**.

Tutto resta sul computer: i documenti non vengono mai inviati su Internet.

## Installazione su Windows

1. Apri la pagina del progetto su GitHub e vai in **Releases** (colonna di destra).
2. Scarica `ZeroPensieri-Setup-x.y.z.exe` dall'ultima versione e aprilo.
3. Windows mostrerà l'avviso «PC protetto da Windows» perché l'installer non è firmato:
   premi **Ulteriori informazioni** e poi **Esegui comunque**.
4. Il programma si installa da solo, crea l'icona sul desktop e si apre.

Alla prima apertura chiede la cartella dove tenere i documenti (va bene anche una cartella che esiste già)
e, se è vuota, propone di creare le cartelle di base (Auto e Moto, Bollette, Multe, Tasse, Salute, Casa, Banca, Altro).

Subito dopo scarica in sottofondo il «lettore di documenti» (il modello OCR, circa 1,8 GB, una volta sola):
serve Internet solo per questo. Nel frattempo il programma si può usare normalmente.

## Come funziona

### La cartella collegata
I file sono normali file dentro la cartella scelta, organizzati come preferisci (di solito `Tema/Anno`, es. `Multe/2026`).
Si possono aprire, copiare e salvare anche senza ZeroPensieri.
Le etichette «Da pagare» / «Già pagato», le scadenze e lo stato delle conversioni stanno in
`<cartella>/.zeropensieri/archivio.json` (cartella nascosta): viaggiano insieme ai documenti, quindi basta
copiare la cartella per avere un backup completo.

### Caricare un documento
- Formati accettati: JPG, PNG, PDF, Word (`.docx`, `.doc`).
- Se un documento ha più fogli fotografati, si aggiungono tutte le foto: restano insieme come
  `Nome - pagina 1.jpg`, `Nome - pagina 2.jpg` con un'unica copia in testo `Nome.md`.
- Il file originale viene **copiato** nell'archivio (quello di partenza non viene toccato) e non sovrascrive mai
  un file esistente: se il nome c'è già diventa `Nome (2)`.
- Con «È da pagare» il documento compare anche in **Cose da pagare**; la scadenza è facoltativa.
  Le scadenze vicine sono evidenziate in arancione, quelle passate in rosso.

### La copia in testo (Markdown)
Se la casella è spuntata (lo è già), accanto all'originale viene creato un file `.md` con il testo del documento.
La lettura è fatta in locale dal modello [PaddleOCR-VL-1.6](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6)
(versione GGUF ufficiale) eseguito con [llama.cpp](https://github.com/ggml-org/llama.cpp).
I file Word `.docx` vengono convertiti direttamente, senza OCR; i vecchi `.doc` vengono archiviati ma non convertiti.

**La lettura è lenta sui computer senza scheda grafica.** L'originale viene archiviato subito; la copia in testo
viene preparata in sottofondo, una pagina alla volta, e compare da sola nella cartella quando è pronta.
In una prova su sola CPU una pagina ha richiesto circa 10 minuti (con la GPU di un Mac circa 20 secondi).
Se il programma viene chiuso a metà, la conversione riparte alla prossima apertura.

## Sviluppo

Serve [Node.js](https://nodejs.org) 22 o più recente.

```bash
npm install
npm run fetch-llama   # scarica llama.cpp per questo computer (in vendor/, non va nel repository)
npm start             # avvia l'app
npm test              # prove automatiche della logica
npm run test:e2e      # prova l'app vera dall'inizio alla fine (senza OCR)
```

Per provare anche l'OCR nella prova completa: `ZP_MODELS_DIR=<cartella con i due file .gguf> npm run test:e2e`.

### Pubblicare una nuova versione
1. Aggiorna `version` in `package.json`.
2. Crea e pubblica il tag: `git tag v0.1.0 && git push origin v0.1.0`.
3. GitHub Actions costruisce l'installer per Windows e lo allega alla release (`.github/workflows/release.yml`).

L'installer si può costruire anche a mano con `npm run dist:win` (funziona anche da macOS): il risultato è in `dist/`.

### Com'è fatto
| Cartella | Contenuto |
|---|---|
| `src/main/archive.js` | cartella collegata, copia dei file, etichette e scadenze |
| `src/main/ocr.js` | download del modello, avvio di `llama-server`, lettura di una pagina |
| `src/main/converter.js` | coda delle conversioni in testo |
| `src/main/main.js` | finestra, comandi dell'interfaccia, protocollo `zp://` che serve i file |
| `src/renderer/` | interfaccia (HTML, CSS e JavaScript senza framework) |
| `scripts/fetch-llama.mjs` | scarica la versione fissata di llama.cpp verificandone l'impronta SHA-256 |
| `test/` | prove automatiche |

## Componenti di terze parti
- Modello PaddleOCR-VL-1.6 (Apache-2.0), scaricato da Hugging Face alla prima apertura.
- llama.cpp (MIT), incluso nell'installer.
- Electron, pdf.js, mammoth, marked, DOMPurify.
