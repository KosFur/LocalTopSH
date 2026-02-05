/**
 * CRM Tools
 * Tools for managing tickets and customers
 */

import { ToolResult } from './index.js';
import {
  getCRMProvider,
  formatTicket,
  formatCustomer,
  formatTicketList,
  TicketStatus,
  TicketPriority,
} from '../crm/index.js';

// ============ TICKET TOOLS ============

/**
 * get_ticket - Get ticket by ID or number
 */
export const getTicketDefinition = {
  type: 'function' as const,
  function: {
    name: 'get_ticket',
    description: `Получить тикет по ID или номеру.
Используй для просмотра деталей заявки клиента.`,
    parameters: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'ID тикета (UUID) или номер (#1001)',
        },
      },
      required: ['ticket_id'],
    },
  },
};

export async function executeGetTicket(args: { ticket_id: string }): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();
    let ticket;

    // Check if it's a number (e.g., "1001" or "#1001")
    const numberMatch = args.ticket_id.match(/^#?(\d+)$/);
    if (numberMatch) {
      ticket = await crm.getTicketByNumber(parseInt(numberMatch[1]));
    } else {
      ticket = await crm.getTicket(args.ticket_id);
    }

    if (!ticket) {
      return { success: false, error: `Тикет "${args.ticket_id}" не найден` };
    }

    return { success: true, output: formatTicket(ticket) };
  } catch (e: any) {
    return { success: false, error: `Ошибка: ${e.message}` };
  }
}

/**
 * search_tickets - Search tickets
 */
export const searchTicketsDefinition = {
  type: 'function' as const,
  function: {
    name: 'search_tickets',
    description: `Поиск тикетов по фильтрам.
Можно искать по статусу, приоритету, клиенту, тексту.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Текст для поиска (в заголовке, описании, имени клиента)',
        },
        status: {
          type: 'string',
          enum: ['new', 'open', 'pending', 'resolved', 'closed'],
          description: 'Фильтр по статусу',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Фильтр по приоритету',
        },
        customer_id: {
          type: 'string',
          description: 'ID клиента для фильтрации',
        },
        limit: {
          type: 'number',
          description: 'Максимум результатов (по умолчанию 10)',
        },
      },
    },
  },
};

export async function executeSearchTickets(args: {
  query?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  customer_id?: string;
  limit?: number;
}): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();
    const tickets = await crm.searchTickets({
      query: args.query,
      status: args.status,
      priority: args.priority,
      customerId: args.customer_id,
      limit: args.limit || 10,
    });

    if (tickets.length === 0) {
      return { success: true, output: 'Тикеты не найдены по заданным критериям' };
    }

    return {
      success: true,
      output: `Найдено ${tickets.length} тикетов:\n\n${formatTicketList(tickets)}`,
    };
  } catch (e: any) {
    return { success: false, error: `Ошибка поиска: ${e.message}` };
  }
}

/**
 * create_ticket - Create new ticket
 */
export const createTicketDefinition = {
  type: 'function' as const,
  function: {
    name: 'create_ticket',
    description: `Создать новый тикет (заявку).
Используй когда клиент обращается с новой проблемой.`,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Заголовок тикета (краткое описание проблемы)',
        },
        description: {
          type: 'string',
          description: 'Подробное описание проблемы',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Приоритет (по умолчанию normal)',
        },
        customer_name: {
          type: 'string',
          description: 'Имя клиента',
        },
        customer_email: {
          type: 'string',
          description: 'Email клиента',
        },
        customer_phone: {
          type: 'string',
          description: 'Телефон клиента',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Теги для категоризации',
        },
      },
      required: ['title'],
    },
  },
};

export async function executeCreateTicket(args: {
  title: string;
  description?: string;
  priority?: TicketPriority;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  tags?: string[];
}): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();
    const ticket = await crm.createTicket({
      title: args.title,
      description: args.description || '',
      priority: args.priority || 'normal',
      customerName: args.customer_name,
      customerEmail: args.customer_email,
      customerPhone: args.customer_phone,
      tags: args.tags || [],
    });

    return {
      success: true,
      output: `✅ Тикет #${ticket.number} создан!\n\n${formatTicket(ticket)}`,
    };
  } catch (e: any) {
    return { success: false, error: `Ошибка создания: ${e.message}` };
  }
}

/**
 * update_ticket - Update ticket
 */
export const updateTicketDefinition = {
  type: 'function' as const,
  function: {
    name: 'update_ticket',
    description: `Обновить тикет (статус, приоритет, исполнителя и т.д.).
Используй для изменения состояния заявки.`,
    parameters: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'ID или номер тикета',
        },
        status: {
          type: 'string',
          enum: ['new', 'open', 'pending', 'resolved', 'closed'],
          description: 'Новый статус',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Новый приоритет',
        },
        assignee_name: {
          type: 'string',
          description: 'Имя исполнителя',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Новые теги',
        },
      },
      required: ['ticket_id'],
    },
  },
};

export async function executeUpdateTicket(args: {
  ticket_id: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee_name?: string;
  tags?: string[];
}): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();

    // Find ticket
    let ticket;
    const numberMatch = args.ticket_id.match(/^#?(\d+)$/);
    if (numberMatch) {
      ticket = await crm.getTicketByNumber(parseInt(numberMatch[1]));
    } else {
      ticket = await crm.getTicket(args.ticket_id);
    }

    if (!ticket) {
      return { success: false, error: `Тикет "${args.ticket_id}" не найден` };
    }

    // Update
    const updated = await crm.updateTicket(ticket.id, {
      status: args.status,
      priority: args.priority,
      assigneeName: args.assignee_name,
      tags: args.tags,
    });

    return {
      success: true,
      output: `✅ Тикет #${updated.number} обновлён!\n\n${formatTicket(updated)}`,
    };
  } catch (e: any) {
    return { success: false, error: `Ошибка обновления: ${e.message}` };
  }
}

/**
 * add_ticket_note - Add note to ticket
 */
export const addTicketNoteDefinition = {
  type: 'function' as const,
  function: {
    name: 'add_ticket_note',
    description: `Добавить заметку к тикету.
Используй для документирования действий и комментариев.`,
    parameters: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'ID или номер тикета',
        },
        content: {
          type: 'string',
          description: 'Текст заметки',
        },
        author_name: {
          type: 'string',
          description: 'Имя автора (по умолчанию "Support Bot")',
        },
        is_internal: {
          type: 'boolean',
          description: 'Внутренняя заметка (не видна клиенту)',
        },
      },
      required: ['ticket_id', 'content'],
    },
  },
};

export async function executeAddTicketNote(args: {
  ticket_id: string;
  content: string;
  author_name?: string;
  is_internal?: boolean;
}): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();

    // Find ticket
    let ticket;
    const numberMatch = args.ticket_id.match(/^#?(\d+)$/);
    if (numberMatch) {
      ticket = await crm.getTicketByNumber(parseInt(numberMatch[1]));
    } else {
      ticket = await crm.getTicket(args.ticket_id);
    }

    if (!ticket) {
      return { success: false, error: `Тикет "${args.ticket_id}" не найден` };
    }

    const note = await crm.addTicketNote(ticket.id, {
      content: args.content,
      authorId: 'bot',
      authorName: args.author_name || 'Support Bot',
      isInternal: args.is_internal ?? true,
    });

    const internal = note.isInternal ? ' (внутренняя)' : '';
    return {
      success: true,
      output: `✅ Заметка добавлена к тикету #${ticket.number}${internal}`,
    };
  } catch (e: any) {
    return { success: false, error: `Ошибка: ${e.message}` };
  }
}

// ============ CUSTOMER TOOLS ============

/**
 * get_customer - Get customer info
 */
export const getCustomerDefinition = {
  type: 'function' as const,
  function: {
    name: 'get_customer',
    description: `Получить информацию о клиенте и историю обращений.`,
    parameters: {
      type: 'object',
      properties: {
        customer_id: {
          type: 'string',
          description: 'ID клиента',
        },
      },
      required: ['customer_id'],
    },
  },
};

export async function executeGetCustomer(args: { customer_id: string }): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();
    const customer = await crm.getCustomer(args.customer_id);

    if (!customer) {
      return { success: false, error: `Клиент "${args.customer_id}" не найден` };
    }

    // Get recent tickets
    const tickets = await crm.getCustomerTickets(customer.id, 5);

    let output = formatCustomer(customer);
    if (tickets.length > 0) {
      output += `\n\n📋 Последние тикеты:\n${formatTicketList(tickets)}`;
    }

    return { success: true, output };
  } catch (e: any) {
    return { success: false, error: `Ошибка: ${e.message}` };
  }
}

/**
 * search_customers - Search customers
 */
export const searchCustomersDefinition = {
  type: 'function' as const,
  function: {
    name: 'search_customers',
    description: `Поиск клиентов по имени, email или телефону.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос (имя, email, телефон)',
        },
        limit: {
          type: 'number',
          description: 'Максимум результатов (по умолчанию 10)',
        },
      },
      required: ['query'],
    },
  },
};

export async function executeSearchCustomers(args: {
  query: string;
  limit?: number;
}): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();
    const customers = await crm.searchCustomers({
      query: args.query,
      limit: args.limit || 10,
    });

    if (customers.length === 0) {
      return { success: true, output: 'Клиенты не найдены' };
    }

    const formatted = customers.map((c) => {
      const contact = [c.email, c.phone].filter(Boolean).join(' | ');
      return `• ${c.name} (${contact}) - ${c.ticketCount} тикетов`;
    });

    return {
      success: true,
      output: `Найдено ${customers.length} клиентов:\n\n${formatted.join('\n')}`,
    };
  } catch (e: any) {
    return { success: false, error: `Ошибка поиска: ${e.message}` };
  }
}

/**
 * create_customer - Create new customer
 */
export const createCustomerDefinition = {
  type: 'function' as const,
  function: {
    name: 'create_customer',
    description: `Создать нового клиента в базе.`,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Имя клиента',
        },
        email: {
          type: 'string',
          description: 'Email',
        },
        phone: {
          type: 'string',
          description: 'Телефон',
        },
        notes: {
          type: 'string',
          description: 'Заметки о клиенте',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Теги',
        },
      },
      required: ['name'],
    },
  },
};

export async function executeCreateCustomer(args: {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  tags?: string[];
}): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();
    const customer = await crm.createCustomer(args);

    return {
      success: true,
      output: `✅ Клиент создан!\n\n${formatCustomer(customer)}`,
    };
  } catch (e: any) {
    return { success: false, error: `Ошибка создания: ${e.message}` };
  }
}

/**
 * add_customer_note - Add note to customer
 */
export const addCustomerNoteDefinition = {
  type: 'function' as const,
  function: {
    name: 'add_customer_note',
    description: `Добавить заметку о клиенте.`,
    parameters: {
      type: 'object',
      properties: {
        customer_id: {
          type: 'string',
          description: 'ID клиента',
        },
        note: {
          type: 'string',
          description: 'Текст заметки (добавляется к существующим)',
        },
      },
      required: ['customer_id', 'note'],
    },
  },
};

export async function executeAddCustomerNote(args: {
  customer_id: string;
  note: string;
}): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();
    const customer = await crm.getCustomer(args.customer_id);

    if (!customer) {
      return { success: false, error: `Клиент "${args.customer_id}" не найден` };
    }

    const timestamp = new Date().toLocaleString('ru-RU');
    const newNotes = customer.notes
      ? `${customer.notes}\n\n[${timestamp}] ${args.note}`
      : `[${timestamp}] ${args.note}`;

    await crm.updateCustomer(customer.id, { notes: newNotes });

    return {
      success: true,
      output: `✅ Заметка добавлена к профилю клиента ${customer.name}`,
    };
  } catch (e: any) {
    return { success: false, error: `Ошибка: ${e.message}` };
  }
}

/**
 * crm_stats - Get CRM statistics
 */
export const crmStatsDefinition = {
  type: 'function' as const,
  function: {
    name: 'crm_stats',
    description: `Получить статистику CRM (количество тикетов, клиентов).`,
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

export async function executeCrmStats(): Promise<ToolResult> {
  try {
    const crm = getCRMProvider();
    const stats = await crm.getStats();

    return {
      success: true,
      output: `📊 Статистика CRM:

🎫 Тикетов всего: ${stats.totalTickets}
📂 Открытых: ${stats.openTickets}
👥 Клиентов: ${stats.totalCustomers}`,
    };
  } catch (e: any) {
    return { success: false, error: `Ошибка: ${e.message}` };
  }
}

// Export all definitions
export const definitions = [
  getTicketDefinition,
  searchTicketsDefinition,
  createTicketDefinition,
  updateTicketDefinition,
  addTicketNoteDefinition,
  getCustomerDefinition,
  searchCustomersDefinition,
  createCustomerDefinition,
  addCustomerNoteDefinition,
  crmStatsDefinition,
];
