const bcrypt = require("bcryptjs");
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Neues Admin-Passwort eingeben (mind. 14 Zeichen empfohlen): ", (password) => {
  rl.close();
  if (!password || password.length < 12) {
    console.error("Bitte ein Passwort mit mindestens 12 Zeichen verwenden.");
    process.exit(1);
  }
  console.log("\nADMIN_PASSWORD_HASH=" + bcrypt.hashSync(password, 12));
});
