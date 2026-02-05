/**
 * Support Commands - Quick access to Knowledge Base and CRM
 * /kb, /ticket, /tickets, /customer, /stats
 */

import { Telegraf, Context } from 'telegraf';
import { executeSearchKnowledge, executeListInstructions } from '../tools/knowledge.js';
import {
  executeSearchTickets,
  executeCreateTicket,
  executeGetTicket,
  executeCrmStats,
  executeSearchCustomers,
} from '../tools/crm.js';
import { escapeHtml } from './formatters.js';

/**
 * /kb [query] - Search knowledge base
 */
export function setupKbCommand(bot: Telegraf) {
  bot.command('kb', async (ctx) => {
    const query = ctx.message?.text?.split(' ').slice(1).join(' ');

    if (!query) {
      // Show available instructions
      const result = await executeListInstructions({});
      if (result.success) {
        await ctx.reply(`📚 <b>База знаний</b>\n\n${escapeHtml(result.output || '')}`, {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(`❌ ${result.error}`);
      }
      return;
    }

    // Search
    await ctx.reply(`🔍 Ищу: "${query}"...`);
    const result = await executeSearchKnowledge({ query, limit: 3 });

    if (result.success) {
      await ctx.reply(result.output || 'Ничего не найдено', { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(`❌ ${result.error}`);
    }
  });
}

/**
 * /ticket [number] - Get ticket or create new
 * /ticket - Show open tickets
 * /ticket 1001 - Get ticket #1001
 * /ticket new Title - Create ticket
 */
export function setupTicketCommand(bot: Telegraf) {
  bot.command('ticket', async (ctx) => {
    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length === 0) {
      // Show open tickets
      const result = await executeSearchTickets({ status: 'open', limit: 10 });
      if (result.success) {
        await ctx.reply(`📂 <b>Открытые тикеты</b>\n\n${escapeHtml(result.output || '')}`, {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(`❌ ${result.error}`);
      }
      return;
    }

    // Check if first arg is a number (ticket ID)
    const numberMatch = args[0].match(/^#?(\d+)$/);
    if (numberMatch) {
      const result = await executeGetTicket({ ticket_id: args[0] });
      if (result.success) {
        await ctx.reply(result.output || '', { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(`❌ ${result.error}`);
      }
      return;
    }

    // Create new ticket
    if (args[0].toLowerCase() === 'new' && args.length > 1) {
      const title = args.slice(1).join(' ');
      const result = await executeCreateTicket({ title });
      if (result.success) {
        await ctx.reply(result.output || '', { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(`❌ ${result.error}`);
      }
      return;
    }

    // Search by text
    const query = args.join(' ');
    const result = await executeSearchTickets({ query, limit: 10 });
    if (result.success) {
      await ctx.reply(`🔍 <b>Поиск: "${escapeHtml(query)}"</b>\n\n${escapeHtml(result.output || '')}`, {
        parse_mode: 'HTML',
      });
    } else {
      await ctx.reply(`❌ ${result.error}`);
    }
  });
}

/**
 * /tickets [status] - List tickets by status
 * /tickets - All open
 * /tickets new - Only new
 * /tickets pending - Only pending
 */
export function setupTicketsCommand(bot: Telegraf) {
  bot.command('tickets', async (ctx) => {
    const status = ctx.message?.text?.split(' ')[1] as any;
    const validStatuses = ['new', 'open', 'pending', 'resolved', 'closed'];

    const filter: any = { limit: 15 };
    if (status && validStatuses.includes(status)) {
      filter.status = status;
    } else if (!status) {
      // Default: show open tickets
      filter.status = ['new', 'open', 'pending'];
    }

    const result = await executeSearchTickets(filter);
    const statusLabel = filter.status
      ? Array.isArray(filter.status)
        ? filter.status.join(', ')
        : filter.status
      : 'все';

    if (result.success) {
      await ctx.reply(`🎫 <b>Тикеты (${statusLabel})</b>\n\n${escapeHtml(result.output || '')}`, {
        parse_mode: 'HTML',
      });
    } else {
      await ctx.reply(`❌ ${result.error}`);
    }
  });
}

/**
 * /customer [query] - Search customers
 */
export function setupCustomerCommand(bot: Telegraf) {
  bot.command('customer', async (ctx) => {
    const query = ctx.message?.text?.split(' ').slice(1).join(' ');

    if (!query) {
      await ctx.reply('Использование: /customer <имя или email>');
      return;
    }

    const result = await executeSearchCustomers({ query, limit: 10 });
    if (result.success) {
      await ctx.reply(`👥 <b>Поиск клиентов</b>\n\n${escapeHtml(result.output || '')}`, {
        parse_mode: 'HTML',
      });
    } else {
      await ctx.reply(`❌ ${result.error}`);
    }
  });
}

/**
 * /stats - CRM statistics
 */
export function setupStatsCommand(bot: Telegraf) {
  bot.command('stats', async (ctx) => {
    const result = await executeCrmStats();
    if (result.success) {
      await ctx.reply(result.output || '', { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(`❌ ${result.error}`);
    }
  });
}

/**
 * /help - Show all commands
 */
export function setupHelpCommand(bot: Telegraf) {
  bot.command('help', async (ctx) => {
    const helpText = `
<b>📚 База знаний</b>
/kb - Список документов
/kb &lt;запрос&gt; - Поиск по базе

<b>🎫 Тикеты</b>
/ticket - Открытые тикеты
/ticket 1001 - Тикет #1001
/ticket new &lt;тема&gt; - Создать тикет
/tickets - Все активные
/tickets new|open|pending - По статусу

<b>👥 Клиенты</b>
/customer &lt;имя/email&gt; - Поиск

<b>📊 Статистика</b>
/stats - Статистика CRM

<b>⚙️ Система</b>
/clear - Очистить сессию
/status - Статус бота
/pending - Ожидающие команды
    `.trim();

    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });
}

/**
 * Setup all support commands
 */
export function setupSupportCommands(bot: Telegraf) {
  setupKbCommand(bot);
  setupTicketCommand(bot);
  setupTicketsCommand(bot);
  setupCustomerCommand(bot);
  setupStatsCommand(bot);
  setupHelpCommand(bot);
}
