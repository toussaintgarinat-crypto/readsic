# readsic — prototype A

Bande originale adaptative générée **à la volée** pendant la lecture d'un texte, avec **mémoire des lieux**.
Aucune dépendance, aucun build : HTML + modules ES + Web Audio.

```bash
npm install
npm start        # puis ouvrir http://localhost:8080 (analyse par mots-clés, sans clé)
npm test
```

## Analyse par LLM — fournisseur au choix

L'analyse sémantique peut être confiée à un LLM (meilleure compréhension des négations, de l'ironie, des lieux non listés). Le navigateur ne parle qu'à `/api/analyze` ; le **serveur** (`server.mjs`) porte la clé et choisit le fournisseur (`providers.mjs`). Aucun fournisseur n'est imposé : sans configuration, l'appli fonctionne avec les mots-clés.

| Fournisseur | Lancement |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY=… npm start` (modèle `claude-haiku-5-5` par défaut, `ANTHROPIC_MODEL` pour changer) |
| Modèle local (Ollama) | `LLM_PROVIDER=ollama LLM_MODEL=llama3.1 npm start` — aucune clé, rien ne quitte la machine |
| LM Studio | `LLM_PROVIDER=lmstudio LLM_MODEL=<modèle> npm start` |
| OpenAI | `LLM_PROVIDER=openai LLM_API_KEY=… LLM_MODEL=gpt-4o-mini npm start` |
| Tout service compatible OpenAI (Mistral, Groq, OpenRouter, vLLM, llama.cpp…) | `LLM_BASE_URL=https://… LLM_API_KEY=… LLM_MODEL=… npm start` |

Ajouter un autre fournisseur = écrire un objet `{ name, model, available(), complete({system, user, schema}) → texte JSON }` dans `providers.mjs`. Le format de sortie est validé et borné côté serveur (`normalizeResults`), donc un modèle moins fiable ne peut pas casser le moteur ; les phrases pas encore analysées retombent sur les mots-clés. Les lots sont analysés en avance de lecture et mis en cache (`localStorage`).

## Mode 2 — cinématographique (`src/storyboard.js`)

« Composer (analyse globale) » lit tout le texte et construit un plan, phrase par phrase :
- **arcs** (titres `Chapitre…` s'il y en a, sinon coupes aux creux de tension) ;
- **climax** par arc et **phases** : introduction → développement → paroxysme → résolution ; la tension monte *avant* le pic (anticipation) et retombe après ;
- **valence** lissée (vote sur ±3 phrases + hystérésis : pas de coq-à-l'âne) ;
- **modulations planifiées**, avec la même persistance par lieu que le mode 1 ;
- **personnages** (noms propres) avec leur **leitmotif** et leur instrument, joués à leur entrée puis rappelés après une absence, transposés dans la tonalité et le mode courants.

Le storyboard est affiché (courbe, phases, lieux, climax) ; un clic sur la courbe saute à l'endroit voulu.

Cliquer sur « Lancer l'audio », puis sur une phrase (ou « Lecture auto », flèches ←/→, espace).

## Ce que démontre le prototype

| Brique | Fichier | Principe |
|---|---|---|
| Fenêtre de lecture (look-ahead) | `src/analyzer.js` | phrase courante + 4 phrases en avance, pondérées : la musique anticipe le danger |
| Analyseur sémantique léger | `src/analyzer.js` | tension (0–1), valence (joyeux / mélancolique / menaçant / neutre), mouvement (0–1) via lexiques FR/EN. Remplaçable par un LLM : même forme de retour |
| Traduction en paramètres musicaux | `src/engine.js` | tension → couche dissonante, percussions, trémolo, brillance ; mouvement → tempo et densité ; valence → gamme |
| Signature sonore par lieu | `src/places.js` | fondamentale, gamme, instrument, réverb, tempo ; leitmotif déterministe par lieu |
| Persistance spatiale | `src/memory.js` | état par lieu (position dans le motif, gamme, « malaise » accumulé) + position de lecture, en `localStorage` |
| Crossfade contextuel | `src/engine.js` | changement de lieu = fondu de 3 s entre scènes ; la tension est une couche **globale** superposée, pas un remplacement |

### Théorie musicale issue du Drive (« projet musique »)

| Source | Utilisation dans le code |
|---|---|
| *Modes de la gamme majeure naturelle* + *Cercle émotionnel des modes* | `MODES` (`src/places.js`) : les 15 modes avec leur caractère ; `VALENCE_MODE` associe chaque valence à un mode (joyeux → ionien, festif → mixolydien, mélancolique → éolien, menaçant → phrygien, tragique → mineur harmonique, onirique → lydien, exotique → phrygien dominant, menace extrême → locrien) |
| *emotion et gamme musicale* | `KEY_EMOTION` : émotion de chaque tonalité, affichée dans l'interface ; la tonique de chaque lieu en est tirée (marécage = Ré mineur « gravité, mystère », forêt = Fa majeur « calme, pastoral », château = Fa mineur « deuil », grotte = Si mineur « solitude »…) |
| *Analyse des Modulations…* | `src/modulation.js` : V (accentue la tension), ♭III relatif majeur (mélancolie → espoir), IV (détente), chromatique (montée dramatique), parallèle (ombre → lumière), retour à la tonique. Déclenchées par les variations de tension/valence, avec glissando. La tonalité modulée est mémorisée avec le lieu |
| *accords / tétrades* | la couche de tension construit un accord diminué 7 (1, ♭3, ♭5, 𝄫7) au fil de la tension ; la nappe de fond prend la tierce du mode courant |

### Scénario de test (texte d'exemple)
forêt → marécage → poursuite (tension, modulation en V) → taverne → rêve dans le désert (lydien, puis phrygien dominant) → **retour au marécage** : le leitmotif du marécage reprend là où il s'était arrêté, et le « malaise » mémorisé le rend plus sombre qu'à la première visite. Recharger la page reprend la lecture à la phrase où l'on s'était arrêté.

## Limites connues / suite
- Analyse par mots-clés : fragile (négations, ironie, anglais partiel) ; l'analyse LLM la remplace quand un fournisseur est configuré. Le LLM n'a pas été testé contre une vraie API dans ce dépôt, seulement contre des serveurs simulés (`test/server.test.mjs`).
- Synthèse simple (oscillateurs) : suffisant pour valider la logique, pas pour la qualité finale ; brancher des samples ou un modèle génératif.
- Non exploité : les partitions de positions de tétrades (`position_*.pdf`), utiles seulement pour un futur moteur d'accords/voicings.
- Mode 2 (analyse globale, storyboard musical, leitmotivs par personnage) non implémenté.
