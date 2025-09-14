import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config();

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const BATCH_DELAY_MS = process.env.BATCH_DELAY_MS ? Number(process.env.BATCH_DELAY_MS) : 500; // ms

// --- Client init ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// --- Command definitions ---
const kickCommand = new SlashCommandBuilder()
  .setName("kickonrole")
  .setDescription("Kick tous les membres possédant un rôle donné")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option.setName("roleid").setDescription("ID ou mention du rôle à purger").setRequired(true)
  )
  .toJSON();

const previewCommand = new SlashCommandBuilder()
  .setName("previewkickonrole")
  .setDescription("Affiche la liste des membres qui seraient expulsés (pas d'action)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option.setName("roleid").setDescription("ID ou mention du rôle à prévisualiser").setRequired(true)
  )
  .toJSON();

const commands = [kickCommand, previewCommand];

// --- REST init ---
const rest = new REST({ version: "10" }).setToken(TOKEN);

// --- Helper utilities ---
function normalizeRoleId(raw) {
  if (!raw) return null;
  const digits = raw.match(/\d{5,}/g);
  return digits ? digits[0] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMembersWithRole(guild, roleId) {
  const role = await guild.roles.fetch(roleId);
  if (!role) return { role: null, members: null };

  const members = await guild.members.fetch();
  const targets = members.filter((m) => m.roles.cache.has(roleId));
  return { role, members: targets };
}

async function kickMembers(targets, reason = "Kick via /kickonrole", delayMs = BATCH_DELAY_MS) {
  let success = 0;
  let fail = 0;
  const details = [];

  for (const member of targets.values()) {
    try {
      if (!member.kickable) {
        fail++;
        details.push({ id: member.id, tag: member.user.tag, error: "Not kickable (role hierarchy / permissions)" });
        continue;
      }

      await member.kick(reason);
      success++;
      details.push({ id: member.id, tag: member.user.tag });
    } catch (err) {
      fail++;
      details.push({ id: member.id, tag: member.user.tag, error: String(err) });
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return { success, fail, details };
}

function buildListFile(targets, roleId) {
  const lines = [];
  for (const m of targets.values()) {
    lines.push(`${m.user.tag} — ${m.id}`);
  }
  const content = `Potentiels kick pour le rôle ${roleId} (${targets.size} membres):\n\n` + lines.join("\n");
  const filename = `potential_kicks_role_${roleId}.txt`;
  const filepath = path.join(process.cwd(), filename);
  fs.writeFileSync(filepath, content, { encoding: "utf8" });
  return { filepath, filename };
}

// --- Register slash commands per guild dynamically at ready ---
client.once("clientReady", async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  for (const [id, guild] of client.guilds.cache) {
    try {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, id), { body: commands });
      console.log(`✅ Commandes enregistrées pour la guilde ${guild.name} (${id})`);
    } catch (err) {
      console.error(`❌ Erreur d'enregistrement pour ${guild.name}:`, err);
    }
  }
});

// --- Interaction handler (messages non-éphémères) ---
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;
  const rawRole = interaction.options.getString("roleid");
  const roleId = normalizeRoleId(rawRole);

  if (!roleId) {
    return interaction.reply({ content: "❌ ID de rôle invalide (fournis l'ID ou la mention du rôle).", ephemeral: false });
  }

  try {
    const fetchResult = await getMembersWithRole(interaction.guild, roleId);
    if (!fetchResult.role) {
      return interaction.reply({ content: "❌ Rôle introuvable.", ephemeral: false });
    }

    const targets = fetchResult.members;

    if (cmd === "previewkickonrole") {
      if (targets.size === 0) {
        return interaction.reply({ content: `✅ Aucun membre n'a le rôle <@&${roleId}>.`, ephemeral: false });
      }

      // reply in channel (visible)
      await interaction.reply({ content: `🔎 ${targets.size} membre(s) trouvés avec <@&${roleId}>. Préparation du fichier...`, ephemeral: false });

      const { filepath, filename } = buildListFile(targets, roleId);

      // followUp will also be visible to the channel
      await interaction.followUp({ content: `Fichier des potentiels kick :`, files: [{ attachment: filepath, name: filename }], ephemeral: false });

      try { fs.unlinkSync(filepath); } catch (e) { /* ignore */ }

      return;
    }

    if (cmd === "kickonrole") {
      if (targets.size === 0) {
        return interaction.reply({ content: `✅ Aucun membre n'a le rôle <@&${roleId}>.`, ephemeral: false });
      }

      await interaction.reply({ content: `⚠️ Kick en cours — ${targets.size} membres trouvés. Opération lancée...`, ephemeral: false });

      const summary = await kickMembers(targets, `Kick via /kickonrole pour rôle ${roleId}`, BATCH_DELAY_MS);

      const resultText = `🚪 Kick terminé. **${summary.success}** expulsés. **${summary.fail}** échecs.`;
      await interaction.followUp({ content: resultText, ephemeral: false });

      if (summary.fail > 0) {
        const lines = summary.details
          .filter((d) => d.error)
          .map((d) => `${d.tag} — ${d.id} — erreur: ${d.error}`);
        const failContent = `Détails des échecs (${lines.length}):\n\n` + lines.join("\n");
        const tmpName = `kick_fail_report_${roleId}.txt`;
        const tmpPath = path.join(process.cwd(), tmpName);
        fs.writeFileSync(tmpPath, failContent, "utf8");
        await interaction.followUp({ content: `Rapport d'échecs :`, files: [{ attachment: tmpPath, name: tmpName }], ephemeral: false });
        try { fs.unlinkSync(tmpPath); } catch (e) {}
      }

      return;
    }
  } catch (err) {
    console.error("Erreur durant l'interaction:", err);
    return interaction.reply({ content: "❌ Une erreur interne est survenue. Voir logs serveur.", ephemeral: false });
  }
});

client.login(TOKEN);
