# Échantillons (facultatif)

Par défaut, tous les instruments sont synthétisés. Pour remplacer un instrument par un vrai son, déposez ici un
fichier **d'une seule note** (wav, mp3, ogg ou flac) et un `manifest.json` :

```json
{
  "flute":   { "file": "flute_C4.wav",  "baseHz": 261.63 },
  "strings": { "file": "cordes_A3.ogg", "baseHz": 220.0, "gain": 0.8 }
}
```

- Clés possibles : `flute`, `pluck`, `bell`, `strings`, `brass`.
- `baseHz` est la hauteur du fichier ; le moteur le transpose (jusqu'à une octave de part et d'autre, au-delà il retombe sur la synthèse).
- Un fichier absent ou illisible laisse l'instrument synthétisé.
- Utilisez des sons dont vous avez les droits (vos enregistrements, banques libres de droits en vérifiant la licence).

`manifest.example.json` montre le format ; copiez-le en `manifest.json` pour l'activer.
