# Venviewer diagram theme

Every Mermaid diagram in this repo uses this theme. Update one place, all diagrams change. Aesthetic is Aman/Four Seasons-adjacent: muted, considered, generous whitespace.

## Palette

- Deep navy `#1a2e3b` — primary structural elements
- Warm gold `#b8965a` — accents, decided/accepted state
- Sage `#7d9579` — in-progress state
- Off-white `#f4ede0` — neutral/not-started state
- Charcoal `#3a3a3a` — text, deferred state
- Terracotta `#a85842` — blocked/at-risk state

## Mermaid init block

Every diagram starts with this. Copy verbatim.

```
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#f4ede0',
    'primaryTextColor': '#1a2e3b',
    'primaryBorderColor': '#1a2e3b',
    'lineColor': '#3a3a3a',
    'secondaryColor': '#b8965a',
    'tertiaryColor': '#7d9579',
    'fontFamily': 'Georgia, serif'
  }
}}%%
```

## Status color classes

Apply to nodes via `class N1,N2 done` etc.

```
classDef done fill:#b8965a,color:#1a2e3b
classDef inprogress fill:#7d9579,color:#f4ede0
classDef deferred fill:#3a3a3a,color:#f4ede0
classDef blocked fill:#a85842,color:#f4ede0
classDef notstarted fill:#f4ede0,color:#1a2e3b
```

## Style rules

- Sentence case in node labels, never ALL CAPS
- Rounded brackets (`(["text"])`) for soft corners, never sharp `["text"]`
- Edge labels lowercase, used sparingly to express "why" not "what"
- Subgraph titles in lowercase
- Maximum 12 nodes per diagram before splitting into subgraphs
- One blank line above and below each subgraph definition
