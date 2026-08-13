// Erzeugt einmalig das Schluesselpaar fuer Push-Nachrichten.
// Der oeffentliche Schluessel kommt in die App, der private bleibt geheim.
import webpush from 'web-push';

const paar = webpush.generateVAPIDKeys();

console.log('\nSchluesselpaar fuer Push-Nachrichten erzeugt.\n');
console.log('1) OEFFENTLICH - traegst du in public/shared/konfiguration.mjs bei VAPID_OEFFENTLICH ein:\n');
console.log(`   ${paar.publicKey}\n`);
console.log('2) PRIVAT - kommt als GitHub-Secret VAPID_PRIVATE. Nirgendwo sonst hinterlegen:\n');
console.log(`   ${paar.privateKey}\n`);
console.log('Beide gehoeren zusammen. Werden sie neu erzeugt, muessen die Mitteilungen neu erlaubt werden.\n');
