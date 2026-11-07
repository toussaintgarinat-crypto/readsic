# readsic — prototype A

Bande originale adaptative générée **à la volée** pendant la lecture d'un texte, avec **mémoire des lieux**.
Aucune dépendance, aucun build : HTML + modules ES + Web Audio.

```bash
npm start        # puis ouvrir http://localhost:8080
npm test         # tests de l'analyseur
```

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

### Scénario de test (texte d'exemple)
forêt → marécage → poursuite (tension) → taverne → **retour au marécage** : le leitmotif du marécage reprend là où il s'était arrêté, et le « malaise » mémorisé le rend plus sombre qu'à la première visite. Recharger la page reprend la lecture à la phrase où l'on s'était arrêté.

## Limites connues / suite
- Analyse par mots-clés : fragile (négations, ironie, anglais partiel). Prochaine étape : classifieur ou LLM rapide derrière la même interface.
- Synthèse simple (oscillateurs) : suffisant pour valider la logique, pas pour la qualité finale ; brancher des samples ou un modèle génératif.
- Mode 2 (analyse globale, storyboard musical, leitmotivs par personnage) non implémenté.
