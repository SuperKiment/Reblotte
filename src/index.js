import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const KICK_DELAY_MS = parseInt(process.env.KICK_DELAY_MS) || 1000;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// --- Utilitaires de debug ---
function debugLog(message, data = null) {
  console.log(`[DEBUG] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

const extractRoleId = (input) => input?.match(/\d{17,19}/)?.[0] || null;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Fonction de debug pour analyser les rôles ---
async function debugRoleAnalysis(guild, roleInput) {
  debugLog("=== ANALYSE COMPLÈTE DU RÔLE ===");
  
  // 1. Informations sur l'input
  debugLog("Input reçu:", {
    type: typeof roleInput,
    value: roleInput,
    id: roleInput?.id,
    name: roleInput?.name
  });

  // 2. État du cache des rôles
  debugLog(`Cache des rôles: ${guild.roles.cache.size} rôles en cache`);
  
  // 3. Chercher le rôle dans le cache
  const roleFromCache = guild.roles.cache.get(roleInput?.id);
  debugLog("Rôle trouvé dans le cache:", !!roleFromCache);
  
  if (roleFromCache) {
    debugLog("Détails du rôle (cache):", {
      id: roleFromCache.id,
      name: roleFromCache.name,
      members_count: roleFromCache.members?.size || 0,
      position: roleFromCache.position,
      color: roleFromCache.hexColor
    });
  }

  // 4. Forcer le fetch du rôle
  debugLog("Tentative de fetch forcé du rôle...");
  try {
    const fetchedRole = await guild.roles.fetch(roleInput.id, { force: true });
    debugLog("Rôle fetchés avec succès:", {
      id: fetchedRole.id,
      name: fetchedRole.name,
      members_count: fetchedRole.members?.size || 0
    });
  } catch (error) {
    debugLog("Erreur lors du fetch du rôle:", error.message);
  }

  // 5. Vérifier l'état du cache des membres
  debugLog(`Cache des membres: ${guild.members.cache.size} membres en cache`);
  debugLog(`Total membres du serveur: ${guild.memberCount}`);

  // 6. Analyser les membres avec ce rôle (méthode 1: via le cache)
  const membersWithRoleCache = guild.members.cache.filter(m => m.roles.cache.has(roleInput.id));
  debugLog(`Membres avec le rôle (cache): ${membersWithRoleCache.size}`);

  // 7. Si le cache est vide, forcer le fetch des membres
  if (guild.members.cache.size < guild.memberCount * 0.1) { // Si moins de 10% en cache
    debugLog("Cache des membres insuffisant, tentative de fetch...");
    try {
      await guild.members.fetch({ limit: 1000 });
      debugLog(`Après fetch partiel: ${guild.members.cache.size} membres en cache`);
      
      const membersAfterFetch = guild.members.cache.filter(m => m.roles.cache.has(roleInput.id));
      debugLog(`Membres avec le rôle (après fetch partiel): ${membersAfterFetch.size}`);
    } catch (error) {
      debugLog("Erreur lors du fetch des membres:", error.message);
    }
  }

  return roleFromCache || guild.roles.cache.get(roleInput.id);
}

// --- Gestion des membres (version debug) ---
async function fetchMembersWithRoleDebug(guild, roleId) {
  debugLog("=== RÉCUPÉRATION DES MEMBRES AVEC RÔLE ===");
  debugLog(`Guild: ${guild.name} (${guild.id})`);
  debugLog(`Role ID recherché: ${roleId}`);

  // Méthode 1: Chercher directement dans le cache
  let role = guild.roles.cache.get(roleId);
  debugLog(`Rôle trouvé dans cache: ${!!role}`);
  
  if (!role) {
    debugLog("Rôle non trouvé dans cache, fetch forcé...");
    try {
      await guild.roles.fetch();
      role = guild.roles.cache.get(roleId);
      debugLog(`Rôle trouvé après fetch: ${!!role}`);
    } catch (error) {
      debugLog("Erreur fetch rôles:", error.message);
      return { role: null, members: new Map(), debug: "Erreur fetch rôles" };
    }
  }

  if (!role) {
    return { role: null, members: new Map(), debug: "Rôle introuvable après tous les essais" };
  }

  debugLog("Détails du rôle trouvé:", {
    id: role.id,
    name: role.name,
    members_from_role: role.members?.size || 0,
    position: role.position
  });

  // Méthode 2: Via role.members (le plus direct)
  if (role.members && role.members.size > 0) {
    debugLog(`✅ Méthode role.members réussie: ${role.members.size} membres`);
    return { role, members: role.members, debug: `role.members: ${role.members.size}` };
  }

  // Méthode 3: Filtrer le cache des membres
  debugLog("role.members vide, essai via cache des membres...");
  debugLog(`Cache membres actuel: ${guild.members.cache.size}/${guild.memberCount}`);

  let membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(roleId));
  debugLog(`Membres trouvés dans cache: ${membersWithRole.size}`);

  // Méthode 4: Si différence importante, forcer fetch complet
  if (guild.members.cache.size < guild.memberCount * 0.8) {
    debugLog("Cache insuffisant pour analyse complète, fetch TOUS les membres...");
    await interaction.editReply("🔄 Cache incomplet détecté, chargement de tous les membres... (peut prendre 1-2 minutes)");
    
    try {
      // Fetch PROGRESSIF pour éviter les timeouts
      const allMembers = await guild.members.fetch({ 
        limit: 0,  // 0 = pas de limite = TOUS
        force: true 
      });
      debugLog(`✅ Fetch complet réussi: ${allMembers.size} membres chargés`);
      
      // Re-filter avec le cache complet
      membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(roleId));
      debugLog(`✅ Membres avec rôle après fetch complet: ${membersWithRole.size}`);
      
      // Mettre à jour role.members aussi
      if (role && role.members) {
        debugLog(`✅ role.members après refresh: ${role.members.size}`);
      }
      
    } catch (error) {
      debugLog("❌ Erreur lors du fetch complet:", error.message);
      // Continuer avec le cache partiel
    }
  }

  return { 
    role, 
    members: membersWithRole,
    debug: `Final: ${membersWithRole.size} membres trouvés`
  };
}

async function processKicks(members, reason, progressCallback) {
  const results = { success: 0, failed: 0, errors: [] };
  const total = members.size;
  let processed = 0;

  for (const [id, member] of members) {
    processed++;
    
    try {
      if (!member.kickable) {
        results.failed++;
        results.errors.push(`${member.user.tag}: Non expulsable`);
      } else {
        await member.kick(reason);
        results.success++;
      }
    } catch (error) {
      results.failed++;
      results.errors.push(`${member.user.tag}: ${error.message}`);
    }
    
    if (processed % 10 === 0 || processed === total) {
      await progressCallback?.(processed, total, results);
    }
    
    await sleep(KICK_DELAY_MS);
  }
  
  return results;
}

async function generateReport(members, roleId, type = "preview") {
  const lines = [`=== RAPPORT ${type.toUpperCase()} ===`];
  lines.push(`Rôle ID: ${roleId}`);
  lines.push(`Nombre de membres: ${members.size}`);
  lines.push(`Date: ${new Date().toLocaleString('fr-FR')}`);
  lines.push('');
  
  for (const [id, member] of members) {
    const kickable = member.kickable ? '✅' : '❌';
    lines.push(`${kickable} ${member.user.tag} (${id})`);
  }
  
  const filename = `${type}_${roleId}_${Date.now()}.txt`;
  const filepath = path.join(process.cwd(), filename);
  
  await fs.writeFile(filepath, lines.join('\n'), 'utf8');
  return { filepath, filename };
}

// --- Commandes avec debug ---
const commands = [
  new SlashCommandBuilder()
    .setName("kickrole")
    .setDescription("🚪 Expulse tous les membres ayant un rôle spécifique")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addRoleOption(option =>
      option.setName("role")
        .setDescription("Le rôle à cibler")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Raison de l'expulsion")
        .setRequired(false)
    ),
    
  new SlashCommandBuilder()
    .setName("previewrole")
    .setDescription("👀 Aperçu des membres qui seraient expulsés")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addRoleOption(option =>
      option.setName("role")
        .setDescription("Le rôle à analyser")
        .setRequired(true)
    ),

  // NOUVELLE COMMANDE DE DEBUG
  new SlashCommandBuilder()
    .setName("debugrole")
    .setDescription("🔍 Debug complet d'un rôle")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addRoleOption(option =>
      option.setName("role")
        .setDescription("Le rôle à analyser en détail")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

// --- Gestionnaire d'interactions avec debug ---
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply();
  
  const { commandName: cmd } = interaction;
  const role = interaction.options.getRole("role");
  const customReason = interaction.options.getString("reason");
  
  debugLog(`Commande reçue: ${cmd}`);
  debugLog("Rôle reçu:", {
    id: role?.id,
    name: role?.name,
    type: typeof role
  });

  if (!role) {
    debugLog("❌ Rôle invalide reçu");
    return interaction.editReply("❌ Rôle invalide ou introuvable.");
  }

  try {
    // NOUVELLE COMMANDE DEBUG
    if (cmd === "debugrole") {
      await interaction.editReply("🔍 **ANALYSE DEBUG EN COURS...**\nConsultez la console pour les détails.");
      
      const analysisRole = await debugRoleAnalysis(interaction.guild, role);
      const { role: finalRole, members, debug } = await fetchMembersWithRoleDebug(interaction.guild, role.id);
      
      const debugInfo = [
        `🔍 **RAPPORT DEBUG COMPLET**`,
        ``,
        `**Serveur:** ${interaction.guild.name}`,
        `**Rôle:** ${role.name} (${role.id})`,
        `**Cache membres:** ${interaction.guild.members.cache.size}/${interaction.guild.memberCount}`,
        `**Cache rôles:** ${interaction.guild.roles.cache.size}`,
        ``,
        `**Résultat final:**`,
        `- Rôle trouvé: ${!!finalRole}`,
        `- Membres détectés: ${members?.size || 0}`,
        `- Debug info: ${debug}`,
        ``,
        `📊 Voir la console pour les détails complets.`
      ];
      
      await interaction.editReply(debugInfo.join('\n'));
      return;
    }

    await interaction.editReply(`🔍 Analyse du rôle **${role.name}**...`);
    
    const { role: finalRole, members, debug } = await fetchMembersWithRoleDebug(interaction.guild, role.id);
    
    debugLog(`Résultat final de fetchMembersWithRoleDebug:`, {
      roleFound: !!finalRole,
      membersCount: members?.size || 0,
      debug
    });
    
    if (!finalRole) {
      return interaction.editReply(`❌ Rôle **${role.name}** introuvable après analyse complète.\n\nDebug: ${debug}`);
    }

    if (!members || members.size === 0) {
      return interaction.editReply(`✅ Aucun membre n'a le rôle **${role.name}**.\n\nDebug: ${debug}\n\n🔍 Utilisez \`/debugrole\` pour une analyse complète.`);
    }

    const kickableCount = members.filter(m => m.kickable).size;
    const nonKickableCount = members.size - kickableCount;

    if (cmd === "previewrole") {
      await interaction.editReply(`📊 **Analyse terminée**\n\n**Rôle:** ${role.name}\n**Total:** ${members.size} membres\n**Expulsables:** ${kickableCount}\n**Non-expulsables:** ${nonKickableCount}\n**Debug:** ${debug}\n\n📄 Génération du rapport...`);
      
      const { filepath, filename } = await generateReport(members, role.id);
      
      await interaction.followUp({
        content: "📋 **Rapport d'analyse**",
        files: [{ attachment: filepath, name: filename }]
      });
      
      await fs.unlink(filepath);
    }
    
    else if (cmd === "kickrole") {
      if (kickableCount === 0) {
        return interaction.editReply(`⚠️ Aucun membre expulsable trouvé.\n\nDebug: ${debug}`);
      }
      
      const reason = customReason || `Expulsion automatique - Rôle: ${role.name}`;
      
      await interaction.editReply(`⚠️ **DÉMARRAGE DE L'EXPULSION**\n\n**Cible:** ${kickableCount} membres\n**Rôle:** ${role.name}\n**Délai:** ${KICK_DELAY_MS}ms entre chaque kick\n\n🚀 Traitement en cours...`);
      
      let lastUpdate = Date.now();
      const results = await processKicks(members, reason, async (processed, total, results) => {
        if (Date.now() - lastUpdate > 5000) {
          await interaction.editReply(`⏳ **Progression: ${processed}/${total}**\n✅ Réussis: ${results.success}\n❌ Échecs: ${results.failed}`);
          lastUpdate = Date.now();
        }
      });
      
      await interaction.editReply(`🏁 **EXPULSION TERMINÉE**\n\n✅ **Réussis:** ${results.success}\n❌ **Échecs:** ${results.failed}\n⏱️ **Durée:** ${Math.round((results.success + results.failed) * KICK_DELAY_MS / 1000)}s`);
      
      if (results.errors.length > 0) {
        const errorFile = `errors_${role.id}_${Date.now()}.txt`;
        await fs.writeFile(errorFile, results.errors.join('\n'), 'utf8');
        
        await interaction.followUp({
          content: `⚠️ **Rapport d'erreurs** (${results.errors.length})`,
          files: [{ attachment: errorFile }]
        });
      }
    }
    
  } catch (error) {
    console.error(`[ERREUR] ${cmd}:`, error);
    await interaction.editReply(`❌ **Erreur critique**\n\`\`\`${error.message}\`\`\``);
  }
});

// --- Initialisation ---
client.once("ready", async () => {
  console.log(`🤖 Bot connecté: ${client.user.tag}`);
  debugLog(`Intents activés: ${Object.keys(GatewayIntentBits).filter(key => client.options.intents.has(GatewayIntentBits[key]))}`);
  
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
      console.log(`✅ Commandes installées: ${guild.name}`);
      
      debugLog(`Guild ${guild.name}:`, {
        memberCount: guild.memberCount,
        rolesCount: guild.roles.cache.size,
        membersInCache: guild.members.cache.size
      });
    } catch (error) {
      console.error(`❌ Erreur installation ${guild.name}:`, error.message);
    }
  }
  
  console.log(`🚀 Bot opérationnel sur ${client.guilds.cache.size} serveur(s)`);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Erreur non gérée:', error);
});

client.login(TOKEN);