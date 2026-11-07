# The Window

Ett fönster in i en levande värld. Två varelser föds i en liten dal och utvecklas därifrån – utan att någon styr dem.

- **Världen** har bara naturlagar: energi, ljus, växter, tyngdkraft, vatten.
- **Varelserna** har kroppar som växer fram ur gener och hjärnor (neurala nät med minne) som lär sig av belöning och smärta.
- **Tiden** går även när appen är stängd, och kan snabbas på upp till 2000×.

## Så byggs appen
Varje push till `main` bygger en APK med GitHub Actions. Den hamnar under **Releases** (lättast att ladda ner på mobilen) och som artefakt i Actions-körningen. Alla byggen signeras med samma nyckel, så en ny version kan installeras ovanpå den gamla utan att världen försvinner.

## Struktur
- `app/src/main/assets/index.html` – gränssnittet
- `app/src/main/assets/js/world.js` – världen, naturlagarna, hjärnorna
- `app/src/main/assets/js/render.js` – ritar dalen och varelserna
- `app/src/main/assets/js/main.js` – tid, kamera, sparning, knappar
- `app/src/main/java/.../MainActivity.kt` – Android-skalet (WebView + sparning till fil)

`index.html` kan också öppnas direkt i en webbläsare för att testa snabbt.
