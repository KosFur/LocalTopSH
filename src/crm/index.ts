/**
 * CRM Module
 * Provides unified interface for CRM operations
 */

import { CRMProvider } from './types.js';
import { FileCRMProvider } from './file-provider.js';
import { CONFIG } from '../config.js';

export * from './types.js';

// CRM provider singleton
let provider: CRMProvider | null = null;

/**
 * Get or create CRM provider
 */
export function getCRMProvider(): CRMProvider {
  if (!provider) {
    // Use file-based provider by default
    // Can be replaced with Zammad provider later
    const storagePath = CONFIG.crm?.storagePath || './crm_data';
    provider = new FileCRMProvider(storagePath);
    console.log(`[crm] Using ${provider.name} provider`);
  }
  return provider;
}

/**
 * Set custom CRM provider (for Zammad, etc.)
 */
export function setCRMProvider(customProvider: CRMProvider): void {
  provider = customProvider;
  console.log(`[crm] Switched to ${provider.name} provider`);
}

/**
 * Format ticket for display
 */
export function formatTicket(ticket: import('./types.js').Ticket): string {
  const { STATUS_EMOJI, PRIORITY_EMOJI, STATUS_NAMES, PRIORITY_NAMES } = require('./types.js');

  const lines = [
    `${STATUS_EMOJI[ticket.status]} **Тикет #${ticket.number}** ${PRIORITY_EMOJI[ticket.priority]}`,
    `📋 ${ticket.title}`,
    ``,
    `Статус: ${STATUS_NAMES[ticket.status]}`,
    `Приоритет: ${PRIORITY_NAMES[ticket.priority]}`,
  ];

  if (ticket.customerName) {
    lines.push(`Клиент: ${ticket.customerName}`);
  }
  if (ticket.customerEmail) {
    lines.push(`Email: ${ticket.customerEmail}`);
  }
  if (ticket.assigneeName) {
    lines.push(`Исполнитель: ${ticket.assigneeName}`);
  }
  if (ticket.tags.length > 0) {
    lines.push(`Теги: ${ticket.tags.join(', ')}`);
  }

  lines.push(`Создан: ${ticket.createdAt.toLocaleString('ru-RU')}`);
  lines.push(`Обновлён: ${ticket.updatedAt.toLocaleString('ru-RU')}`);

  if (ticket.description) {
    lines.push(``, `---`, `${ticket.description.slice(0, 500)}${ticket.description.length > 500 ? '...' : ''}`);
  }

  if (ticket.notes.length > 0) {
    lines.push(``, `💬 Заметки (${ticket.notes.length}):`);
    for (const note of ticket.notes.slice(-3)) {
      const internal = note.isInternal ? ' [внутр.]' : '';
      lines.push(`  • ${note.authorName}${internal}: ${note.content.slice(0, 100)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format customer for display
 */
export function formatCustomer(customer: import('./types.js').Customer): string {
  const lines = [
    `👤 **${customer.name}**`,
    `ID: ${customer.id.slice(0, 8)}`,
  ];

  if (customer.email) {
    lines.push(`📧 ${customer.email}`);
  }
  if (customer.phone) {
    lines.push(`📱 ${customer.phone}`);
  }
  if (customer.tags.length > 0) {
    lines.push(`🏷️ ${customer.tags.join(', ')}`);
  }

  lines.push(`🎫 Тикетов: ${customer.ticketCount}`);

  if (customer.lastTicketAt) {
    lines.push(`📅 Последний: ${customer.lastTicketAt.toLocaleString('ru-RU')}`);
  }

  if (customer.notes) {
    lines.push(``, `📝 ${customer.notes.slice(0, 200)}`);
  }

  return lines.join('\n');
}

/**
 * Format ticket list for display
 */
export function formatTicketList(tickets: import('./types.js').Ticket[]): string {
  const { STATUS_EMOJI, PRIORITY_EMOJI } = require('./types.js');

  if (tickets.length === 0) {
    return 'Тикеты не найдены';
  }

  const lines = tickets.map((t) => {
    const customer = t.customerName ? ` | ${t.customerName}` : '';
    const date = t.updatedAt.toLocaleDateString('ru-RU');
    return `${STATUS_EMOJI[t.status]} #${t.number} ${PRIORITY_EMOJI[t.priority]} ${t.title.slice(0, 40)}${customer} (${date})`;
  });

  return lines.join('\n');
}
