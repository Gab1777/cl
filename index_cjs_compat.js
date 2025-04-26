// Este é um exemplo genérico de CL em CommonJS
const { Client, Intents } = require('discord.js');
const readline = require('readline');

// Usando o token passado pelo contexto
const token = global.token || token;

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.DIRECT_MESSAGES
  ],
  partials: ['CHANNEL']
});

client.once('ready', () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`
1. Apagar todas as DMs de amigos`);
  console.log(`2. Apagar mensagens de DMs abertas`);
  console.log(`3. Apagar mensagens de um canal específico`);
  console.log(`4. Remover todos os amigos`);
  console.log(`5. Escanear servidores`);
  console.log(`6. Dashboard de estatísticas`);
  console.log(`7. Apagar mensagens com conteúdo específico`);
  console.log(`0. Sair`);

  rl.question('\nEscolha uma opção: ', (answer) => {
    console.log(`Você escolheu a opção ${answer}`);
    rl.close();
    process.exit(0);
  });
});

client.login(token);
