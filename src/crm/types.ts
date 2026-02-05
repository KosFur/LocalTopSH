/**
 * CRM Types and Interfaces
 * Abstract interfaces for CRM integration
 */

// Ticket status
export type TicketStatus = 'new' | 'open' | 'pending' | 'resolved' | 'closed';

// Ticket priority
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

// Ticket interface
export interface Ticket {
  id: string;
  number: number;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  assigneeId?: string;
  assigneeName?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  notes: TicketNote[];
}

// Ticket note/comment
export interface TicketNote {
  id: string;
  ticketId: string;
  content: string;
  authorId: string;
  authorName: string;
  isInternal: boolean;  // Internal note (not visible to customer)
  createdAt: Date;
}

// Customer interface
export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  notes: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  ticketCount: number;
  lastTicketAt?: Date;
}

// Search filters
export interface TicketSearchFilters {
  status?: TicketStatus | TicketStatus[];
  priority?: TicketPriority | TicketPriority[];
  customerId?: string;
  assigneeId?: string;
  tags?: string[];
  query?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

export interface CustomerSearchFilters {
  query?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

// CRM Provider interface (abstract)
export interface CRMProvider {
  name: string;

  // Tickets
  getTicket(id: string): Promise<Ticket | null>;
  getTicketByNumber(number: number): Promise<Ticket | null>;
  searchTickets(filters: TicketSearchFilters): Promise<Ticket[]>;
  createTicket(data: Partial<Ticket>): Promise<Ticket>;
  updateTicket(id: string, data: Partial<Ticket>): Promise<Ticket>;
  addTicketNote(ticketId: string, note: Omit<TicketNote, 'id' | 'ticketId' | 'createdAt'>): Promise<TicketNote>;

  // Customers
  getCustomer(id: string): Promise<Customer | null>;
  searchCustomers(filters: CustomerSearchFilters): Promise<Customer[]>;
  createCustomer(data: Partial<Customer>): Promise<Customer>;
  updateCustomer(id: string, data: Partial<Customer>): Promise<Customer>;
  getCustomerTickets(customerId: string, limit?: number): Promise<Ticket[]>;

  // Stats
  getStats(): Promise<{
    totalTickets: number;
    openTickets: number;
    totalCustomers: number;
  }>;
}

// Status display names
export const STATUS_NAMES: Record<TicketStatus, string> = {
  new: 'Новый',
  open: 'Открыт',
  pending: 'Ожидание',
  resolved: 'Решён',
  closed: 'Закрыт',
};

// Priority display names
export const PRIORITY_NAMES: Record<TicketPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочный',
};

// Priority emoji
export const PRIORITY_EMOJI: Record<TicketPriority, string> = {
  low: '🟢',
  normal: '🟡',
  high: '🟠',
  urgent: '🔴',
};

// Status emoji
export const STATUS_EMOJI: Record<TicketStatus, string> = {
  new: '🆕',
  open: '📂',
  pending: '⏳',
  resolved: '✅',
  closed: '🔒',
};
