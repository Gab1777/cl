import { Client } from 'discord.js-selfbot-v13';
import figlet from 'figlet';
import colors from 'colors';
import axios from 'axios';
import fs from 'fs';
import readline from 'readline';
import cliProgress from 'cli-progress';
import ora from 'ora';
import { RateLimiter } from 'limiter';
import path from 'path';
import { fileURLToPath } from 'url';
process.title = "cl | by @fraudavel";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Suppress Node.js warnings
process.removeAllListeners('warning');

const limiter = new RateLimiter({
  tokensPerInterval: 950,
  interval: 'hour'
});

colors.setTheme({
  silly: 'red',
  input: 'blue',
  verbose: 'cyan',
  prompt: 'grey',
  info: 'white',
  data: 'grey',
  help: 'cyan',
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
});

const client = new Client({ checkUpdate: false });
const per = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const BATCH_DELETE_DELAY = 200;
const MAX_PARALLEL_REQUESTS = 5;
const MESSAGE_FETCH_LIMIT = 100;

const progressBar = new cliProgress.Bar({
  format: '{bar} {percentage}% | {value}/{total} | {username}',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
  hideCursor: true
});

const logs = {
  deletedMessages: [],
  removedFriends: [],
  startTime: new Date()
};

async function verifyToken(token) {
  try {
    const response = await axios.get('https://discord.com/api/v9/users/@me', {
      headers: {
        'Authorization': token,
        'User-Agent': 'Mozilla/5.0'
      }
    });
    
    const user = response.data;
    const flags = user.public_flags || 0;
    const badges = [];
    
    if (flags & 1) badges.push('Staff');
    if (flags & 2) badges.push('Parceiro');
    if (flags & 4) badges.push('Hypesquad');
    if (flags & 8) badges.push('Bug Hunter Nível 1');
    if (flags & 64) badges.push('Hypesquad Bravery');
    if (flags & 128) badges.push('Hypesquad Brilliance');
    if (flags & 256) badges.push('Hypesquad Balance');
    if (flags & 512) badges.push('Early Supporter');
    if (flags & 16384) badges.push('Bug Hunter Nível 2');
    if (flags & 131072) badges.push('Moderador de Programas');
    if (flags & 4194304) badges.push('Desenvolvedor Ativo');
    if (flags & 8589934592) badges.push('Certified Moderator');
    
    return {
      valid: true,
      username: `${user.username}#${user.discriminator}`,
      id: user.id,
      badges: badges.length ? badges : ['Nenhum badge'],
      email: user.email || 'Não verificado',
      phone: user.phone || 'Não vinculado'
    };
  } catch (error) {
    return { valid: false };
  }
}

function renderProgressText(current, total, username) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  return `Deletando mensagens de ${username}: ${current}/${total} (${percentage}%)`;
}

async function showProgressWithSpinner(current, total, username) {
  const spinner = ora({
    text: renderProgressText(current, total, username),
    color: 'cyan'
  }).start();

  return {
    update: (newCurrent) => {
      spinner.text = renderProgressText(newCurrent, total, username);
    },
    stop: () => spinner.stop()
  };
}


async function fetchMessages(channelId) {
  const channel = client.channels.cache.get(channelId);
  if (!channel) return [];

  let messages = [];
  let lastId;
  let fetchCount = 0;
  const YOUR_USER_ID = client.user.id;

  const spinner = ora('Buscando suas mensagens...').start();

  while (fetchCount < 10) {
    await limiter.removeTokens(1);
    const fetched = await channel.messages.fetch({
      limit: MESSAGE_FETCH_LIMIT,
      ...(lastId && { before: lastId })
    }).catch(() => null);

    if (!fetched || fetched.size === 0) break;

    const yourMessages = Array.from(fetched.values()).filter(
      msg => msg.author.id === YOUR_USER_ID
    );
    
    messages = messages.concat(yourMessages);
    lastId = fetched.lastKey();
    fetchCount++;
    spinner.text = `Suas mensagens encontradas: ${messages.length}`;
  }

  spinner.succeed(`Total de suas mensagens: ${messages.length}`);
  return messages;
}

async function deleteMessagesBatch(channel, messages, progressBar, deletedCountRef) {
  try {
    await limiter.removeTokens(1);

    let deletedCountRef = { count: 0 };

    for (const msg of messages) {
      deletedCountRef.count++;
      if (progressBar) progressBar.update(deletedCountRef.count);
      try {
        await msg.delete();
        deletedCountRef.count++;
      } catch (err) {
        if (!err.message.includes('Cannot execute action on a system message')) {
          console.log(`Erro ao deletar mensagem ${msg.id}: ${err.message}`.error);
        }
      }
    }

    return deletedCountRef.count;

  } catch (error) {
    console.error('Erro no batch delete:'.error, error.message);
    return 0;
  }
}
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



async function getFriends() {
  try {
    const response = await axios.get('https://discord.com/api/v9/users/@me/relationships', {
      headers: {
        'Authorization': client.token,
        'User-Agent': 'Mozilla/5.0'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Erro ao obter amigos:'.error, error.message);
    return [];
  }
}

async function closeDM(channelId) {
  try {
    await axios.delete(`https://discord.com/api/v9/channels/${channelId}`, {
      headers: { 'Authorization': client.token }
    });
  } catch (error) {
    console.error('Erro ao fechar DM:'.error, error.message);
  }
}

async function backupMessages(messages, username) {
  const backupDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(backupDir, `backup-${username}-${timestamp}.json`);
  
  const backupData = messages.map(msg => ({
    id: msg.id,
    content: msg.content,
    timestamp: msg.createdTimestamp,
    attachments: msg.attachments.map(a => a.url)
  }));
  
  fs.writeFileSync(filename, JSON.stringify(backupData, null, 2));
  return filename;
}

function saveLogs() {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(logsDir, `logs-${timestamp}.json`);
  
  const runtime = (new Date() - logs.startTime) / 1000;
  const logData = {
    ...logs,
    runtime: `${runtime} segundos`,
    endTime: new Date()
  };
  
  fs.writeFileSync(filename, JSON.stringify(logData, null, 2));
  return filename;
}

async function deleteAllFriendDMs() {
  console.log('\n[1] Buscando amigos...'.input);
  const amigos = await getFriends();

  if (amigos.length === 0) {
    console.log('Nenhum amigo encontrado.'.data);
    return;
  }

  let totalDeleted = 0;
  progressBar.start(amigos.length, 0, { username: 'Geral' });

  for (let i = 0; i < amigos.length; i += MAX_PARALLEL_REQUESTS) {
    const batch = amigos.slice(i, i + MAX_PARALLEL_REQUESTS);

    await Promise.all(batch.map(async (user, index) => {
      try {
        const discordUser = await client.users.fetch(user.id).catch(() => null);
        if (!discordUser) return;

        const currentPosition = i + index + 1;
        progressBar.update(currentPosition, { username: discordUser.username });

        const dm = await discordUser.createDM();
        const messages = await fetchMessages(dm.id);

        if (messages.length === 0) {
          await closeDM(dm.id);
          return;
        }

        const backupFile = await backupMessages(messages, discordUser.username);
        console.log(`Backup salvo em: ${backupFile}`.info);

        const spinner = await showProgressWithSpinner(0, messages.length, discordUser.username);

        
        for (let j = 0; j < messages.length; j += MESSAGE_FETCH_LIMIT) {
          const batchMessages = messages.slice(j, j + MESSAGE_FETCH_LIMIT);
          const deleted = await deleteMessagesBatch(dm, batchMessages);
          // atualizado dentro de deleteMessagesBatch
          spinner.update(deletedCountRef.count);
          await wait(BATCH_DELETE_DELAY);
        }

        spinner.stop();
        totalDeleted += deletedCountRef.count;
        logs.deletedMessages.push({
          user: discordUser.username,
          count: deletedCountRef.count,
          backupFile
        });
        console.log(`\nTotal deletado: ${deletedCountRef.count} mensagens de ${discordUser.username}`.info);
        await closeDM(dm.id);
      } catch (error) {
        console.error(`Erro com ${user.id}:`.error, error.message);
      }
    }));
  }

  progressBar.stop();
  console.log(`\nTotal geral apagado: ${totalDeleted} mensagens`.info);
  const logFile = saveLogs();
  console.log(`Logs salvos em: ${logFile}`.info);
}

async function deleteOpenDMs() {
  console.log('\n[2] Buscando DMs abertas...'.input);
  const openDMs = Array.from(client.channels.cache.filter(c => c.type === 'DM').values());

  if (openDMs.length === 0) {
    console.log('Nenhuma DM aberta encontrada.'.data);
    return;
  }

  let totalDeleted = 0;
  progressBar.start(openDMs.length, 0, { username: 'DMs Abertas' });

  for (let i = 0; i < openDMs.length; i++) {
    const channel = openDMs[i];
    try {
      const username = channel.recipient?.username || 'usuário desconhecido';
      progressBar.update(i + 1, { username });

      const messages = await fetchMessages(channel.id);
      if (messages.length === 0) continue;

      const backupFile = await backupMessages(messages, username);
      console.log(`Backup salvo em: ${backupFile}`.info);

      const spinner = await showProgressWithSpinner(0, messages.length, username);

      let deletedCountRef = { count: 0 };
      for (let j = 0; j < messages.length; j += MESSAGE_FETCH_LIMIT) {
        const batchMessages = messages.slice(j, j + MESSAGE_FETCH_LIMIT);
        const deleted = await deleteMessagesBatch(channel, batchMessages);
        // atualizado dentro de deleteMessagesBatch
        spinner.update(deletedCountRef.count);
        await wait(BATCH_DELETE_DELAY);
      }

      spinner.stop();
      totalDeleted += deletedCountRef.count;
      logs.deletedMessages.push({
        user: username,
        count: deletedCountRef.count,
        backupFile
      });
      console.log(`\nTotal deletado: ${deletedCountRef.count} mensagens de ${username}`.info);
    } catch (error) {
      console.error(`Erro na DM ${channel.id}:`.error, error.message);
    }
  }

  progressBar.stop();
  console.log(`\nTotal geral apagado: ${totalDeleted} mensagens`.info);
  const logFile = saveLogs();
  console.log(`Logs salvos em: ${logFile}`.info);
}

async function deleteSpecificChannel() {
  per.question('\nDigite o ID do canal/usuário: '.prompt, async (id) => {
    try {
      let channel = client.channels.cache.get(id);
      let targetName = '';

      if (!channel) {
        const spinner = ora('Buscando usuário...').start();
        const user = await client.users.fetch(id).catch(() => null);
        spinner.stop();

        if (!user) {
          console.log('ID inválido'.error);
          return;
        }
        channel = await user.createDM();
        targetName = user.username;
      } else {
        targetName = channel.recipient?.username || channel.name || 'Canal desconhecido';
      }

      const messages = await fetchMessages(channel.id);
      if (messages.length === 0) {
        console.log('Nenhuma mensagem para deletar'.data);
        return;
      }

      const backupFile = await backupMessages(messages, targetName);
      console.log(`Backup salvo em: ${backupFile}`.info);

      const spinner = await showProgressWithSpinner(0, messages.length, targetName);

      
      for (let j = 0; j < messages.length; j += MESSAGE_FETCH_LIMIT) {
        const batchMessages = messages.slice(j, j + MESSAGE_FETCH_LIMIT);
        const deleted = await deleteMessagesBatch(channel, batchMessages);
        // atualizado dentro de deleteMessagesBatch
        spinner.update(deletedCountRef.count);
        await wait(BATCH_DELETE_DELAY);
      }

      spinner.stop();
      logs.deletedMessages.push({
        user: targetName,
        count: deletedCountRef.count,
        backupFile
      });
      console.log(`\nTotal deletado: ${deletedCountRef.count}/${messages.length} mensagens de ${targetName}`.info);
      const logFile = saveLogs();
      console.log(`Logs salvos em: ${logFile}`.info);
    } catch (error) {
      console.error('\nErro:'.error, error.message);
    } finally {
      setTimeout(() => showMenu(), 3000);
    }
  });
}

async function removeAllFriends() {
  console.log('\n[4] Buscando amigos...'.input);
  const amigos = await getFriends();

  if (amigos.length === 0) {
    console.log('Nenhum amigo encontrado.'.data);
    return;
  }

  let removedCount = 0;
  progressBar.start(amigos.length, 0, { username: 'Removendo amigos' });

  for (let i = 0; i < amigos.length; i += MAX_PARALLEL_REQUESTS) {
    const batch = amigos.slice(i, i + MAX_PARALLEL_REQUESTS);

    await Promise.all(batch.map(async (user, index) => {
      if (user.type !== 1) return;

      try {
        await limiter.removeTokens(1);
        await axios.delete(`https://discord.com/api/v9/users/@me/relationships/${user.id}`, {
          headers: { 'Authorization': client.token }
        });
        removedCount++;
        logs.removedFriends.push({
          id: user.id,
          username: user.user?.username || 'Desconhecido'
        });
        progressBar.update(i + index + 1);
        console.log(`Removido: ${user.id}`.info);
      } catch (error) {
        console.error(`Erro removendo ${user.id}:`.error, error.message);
      }
    }));
    await wait(500);
  }

  progressBar.stop();
  console.log(`\nTotal removido: ${removedCount} amigos`.info);
  const logFile = saveLogs();
  console.log(`Logs salvos em: ${logFile}`.info);
}

async function scanServers() {
  console.log('\n[5] Escaneando servidores...'.input);
  
  const servers = client.guilds.cache.map(guild => ({
    id: guild.id,
    name: guild.name,
    owner: guild.ownerId,
    memberCount: guild.memberCount,
    channels: guild.channels.cache.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: channel.type
    }))
  }));
  
  const scanDir = path.join(__dirname, 'scans');
  if (!fs.existsSync(scanDir)) {
    fs.mkdirSync(scanDir);
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(scanDir, `servers-scan-${timestamp}.json`);
  
  fs.writeFileSync(filename, JSON.stringify(servers, null, 2));
  console.log(`\nScan concluído! Dados salvos em: ${filename}`.info);
}

async function deleteMessagesWithContent(content) {
  console.log(`\n[+] Buscando mensagens contendo: "${content}"`.input);
  
  let totalDeleted = 0;
  const allChannels = client.channels.cache.filter(c => c.type === 'DM' || c.isText());

  progressBar.start(allChannels.size, 0, { username: 'Canais verificados' });

  for (const [channelId, channel] of allChannels) {
    try {
      progressBar.increment({ username: channel.name || channel.recipient?.username || 'DM' });
      
      const messages = await fetchMessages(channelId);
      const targetMessages = messages.filter(msg => 
        msg.content.toLowerCase().includes(content.toLowerCase())
      );

      if (targetMessages.length === 0) continue;

      const deleted = await deleteMessagesBatch(channel, targetMessages);
      totalDeleted += deleted;
      
      logs.deletedMessages.push({
        channel: channel.name || 'DM',
        user: channel.recipient?.username || 'N/A',
        content: content,
        count: deleted
      });

    } catch (error) {
      console.error(`Erro no canal ${channelId}:`.error, error.message);
    }
  }

  progressBar.stop();
  console.log(`\nTotal de mensagens contendo "${content}" deletadas: ${totalDeleted}`.info);
  saveLogs();
}

async function handleDeiclCommand(message) {
  if (!message.content.toLowerCase().startsWith('deicl')) return;
  
  const channel = message.channel;
  const content = message.content.slice(5).trim();
  
  try {
    const spinner = ora('Buscando suas mensagens...').start();
    const messages = await fetchMessages(channel.id);
    
    const toDelete = content 
      ? messages.filter(msg => 
          msg.content.toLowerCase().includes(content.toLowerCase()) &&
          msg.author.id === client.user.id
        )
      : messages;

    if (toDelete.length === 0) {
      spinner.fail('Nenhuma mensagem encontrada');
      return;
    }

    spinner.stop();

    const targetUsername = channel.recipient?.username || channel.name || 'Canal';
    let deletedCountRef = { count: 0 };

    
    

    const progressBar = new cliProgress.SingleBar({
      format: `Deletando mensagens de ${targetUsername} | {bar} {percentage}% | {value}/{total}`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });
    progressBar.start(toDelete.length, 0);

    for (let i = 0; i < toDelete.length; i += MESSAGE_FETCH_LIMIT) {
      const batch = toDelete.slice(i, i + MESSAGE_FETCH_LIMIT);
      const deleted = await deleteMessagesBatch(channel, batch, progressBar, deletedCountRef);
      // atualizado dentro de deleteMessagesBatch
      progressBar.update(deletedCountRef.count);
      await wait(BATCH_DELETE_DELAY);
    }

    progressBar.stop();
    console.log(`[+] Todas às mensagens de ${targetUsername} foram deletadas!\n`.brightGreen);

    
    
    
    logs.deletedMessages.push({
      channel: channel.name || 'DM',
      user: channel.recipient?.username || 'N/A',
      count: deletedCountRef.count,
      contentFilter: content || 'Todas'
    });
    saveLogs();
    setTimeout(() => showMenu(), 3000);
    
  } catch (error) {
    console.error('Erro no comando deicl:'.error, error.message);
  }
}

function showDashboard() {
  console.clear();
  
  const runtime = (new Date() - logs.startTime) / 1000;
  const deletedCountRef = { count: logs.deletedMessages.reduce((sum, item) => sum + item.count, 0) };
  const uniqueUsers = [...new Set(logs.deletedMessages.map(item => item.user))].length;
  
  figlet.text('Dashboard', {
    font: 'Gothic',
    horizontalLayout: 'default',
    verticalLayout: 'default'
  }, (err, data) => {
    if (err) {
      console.log('=== Dashboard ==='.silly);
    } else {
      console.log(data.silly);
    }
    
    console.log('\nEstatísticas'.info);
    console.log(`Tempo de execução: ${runtime.toFixed(2)} segundos`.info);
    console.log(`Mensagens deletadas: ${deletedCountRef.count}`.info);
    console.log(`Usuários afetados: ${uniqueUsers}`.info);
    console.log(`Amigos removidos: ${logs.removedFriends.length}`.info);
    
    console.log('\nPressione qualquer tecla para voltar...'.prompt);
    process.stdin.once('data', () => showMenu());
  });
}

function showMenu() {
  console.clear();
  const displayName = client.user.displayName || client.user.username;

  figlet.text(displayName, {
    font: 'Gothic',
    horizontalLayout: 'default',
    verticalLayout: 'default'
  }, (err, data) => {
    if (err) {
      console.log(`=== ${displayName} ===`.silly);
    } else {
      console.log(data.silly);
    }

    console.log(''.info);
    console.log('1. Apagar todas as DMs de amigos'.info);
    console.log('2. Apagar mensagens de DMs abertas'.info);
    console.log('3. Apagar mensagens de um canal específico'.info);
    console.log('4. Remover todos os amigos'.info);
    console.log('5. Escanear servidores'.info);
    console.log('6. Dashboard de estatísticas'.info);
    console.log('7. Apagar mensagens com conteúdo específico'.info);
    console.log('0. Sair\n'.info);

    per.question('Digite o número: '.input, async (option) => {
      console.clear();
      try {
        switch (option) {
          case '1': await deleteAllFriendDMs(); break;
          case '2': await deleteOpenDMs(); break;
          case '3': await deleteSpecificChannel(); break;
          case '4': await removeAllFriends(); break;
          case '5': await scanServers(); break;
          case '6': showDashboard(); return;
          case '7': 
            per.question('Digite o conteúdo a ser deletado: '.input, async (content) => {
              await deleteMessagesWithContent(content);
              setTimeout(() => showMenu(), 3000);
            });
            return;
          case '0': 
            saveLogs();
            process.exit(0);
          default: console.log('Opção inválida'.error);
        }
      } catch (error) {
        console.error('Erro:'.error, error.message);
      }

      setTimeout(() => showMenu(), 3000);
    });
  });
}

async function initialize() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath));
      const tokenInfo = await verifyToken(config.token);
      
      if (!tokenInfo.valid) {
        throw new Error('Token inválida');
      }
      
      console.log(`Token válida | Usuário: ${tokenInfo.username}`.info);
      console.log(`Badges: ${tokenInfo.badges.join(', ')}`.info);
      
      await client.login(config.token);
    } else {
      console.clear();
      per.question('Insira seu token do Discord: '.input, async (token) => {
        const tokenInfo = await verifyToken(token);
        
        if (!tokenInfo.valid) {
          console.log('Token inválida!'.error);
          process.exit(1);
        }
        
        console.log(`\nToken válida | Usuário: ${tokenInfo.username}`.info);
        console.log(`Badges: ${tokenInfo.badges.join(', ')}`.info);
        
        await client.login(token);
        fs.writeFileSync('config.json', JSON.stringify({ token: client.token }, null, 2));
        console.log('Login realizado! Configuração salva.'.info);
      });
    }
  } catch (error) {
    console.error('Erro na inicialização:'.error, error.message);
    process.exit(1);
  }
}

client.on('ready', () => {
  console.log(`Conectado como ${client.user.username}`.info);
  showMenu();
});

client.on('messageCreate', async message => {
  if (message.author.id === client.user.id) {
    await handleDeiclCommand(message);
  }
});

initialize();