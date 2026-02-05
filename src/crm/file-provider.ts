/**
 * File-based CRM Provider
 * Stores tickets and customers in JSON files
 * Perfect for testing and small teams
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  CRMProvider,
  Ticket,
  TicketNote,
  Customer,
  TicketSearchFilters,
  CustomerSearchFilters,
  TicketStatus,
  TicketPriority,
} from './types.js';

interface FileStore {
  tickets: Record<string, Ticket>;
  customers: Record<string, Customer>;
  nextTicketNumber: number;
}

export class FileCRMProvider implements CRMProvider {
  name = 'file';
  private storePath: string;
  private store: FileStore;

  constructor(storagePath: string = './crm_data') {
    this.storePath = path.resolve(storagePath);
    this.store = this.loadStore();
  }

  private getStoreFilePath(): string {
    return path.join(this.storePath, 'crm_store.json');
  }

  private loadStore(): FileStore {
    const filePath = this.getStoreFilePath();

    // Create directory if not exists
    if (!fs.existsSync(this.storePath)) {
      fs.mkdirSync(this.storePath, { recursive: true });
    }

    // Load or create store
    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        // Convert date strings back to Date objects
        for (const ticket of Object.values(parsed.tickets) as Ticket[]) {
          ticket.createdAt = new Date(ticket.createdAt);
          ticket.updatedAt = new Date(ticket.updatedAt);
          if (ticket.closedAt) ticket.closedAt = new Date(ticket.closedAt);
          for (const note of ticket.notes) {
            note.createdAt = new Date(note.createdAt);
          }
        }
        for (const customer of Object.values(parsed.customers) as Customer[]) {
          customer.createdAt = new Date(customer.createdAt);
          customer.updatedAt = new Date(customer.updatedAt);
          if (customer.lastTicketAt) customer.lastTicketAt = new Date(customer.lastTicketAt);
        }
        return parsed;
      } catch (e) {
        console.error('[crm] Failed to load store, creating new:', e);
      }
    }

    // Create empty store
    return {
      tickets: {},
      customers: {},
      nextTicketNumber: 1000,
    };
  }

  private saveStore(): void {
    const filePath = this.getStoreFilePath();
    fs.writeFileSync(filePath, JSON.stringify(this.store, null, 2));
  }

  // ============ TICKETS ============

  async getTicket(id: string): Promise<Ticket | null> {
    return this.store.tickets[id] || null;
  }

  async getTicketByNumber(number: number): Promise<Ticket | null> {
    const ticket = Object.values(this.store.tickets).find((t) => t.number === number);
    return ticket || null;
  }

  async searchTickets(filters: TicketSearchFilters): Promise<Ticket[]> {
    let tickets = Object.values(this.store.tickets);

    // Apply filters
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      tickets = tickets.filter((t) => statuses.includes(t.status));
    }

    if (filters.priority) {
      const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
      tickets = tickets.filter((t) => priorities.includes(t.priority));
    }

    if (filters.customerId) {
      tickets = tickets.filter((t) => t.customerId === filters.customerId);
    }

    if (filters.assigneeId) {
      tickets = tickets.filter((t) => t.assigneeId === filters.assigneeId);
    }

    if (filters.tags && filters.tags.length > 0) {
      tickets = tickets.filter((t) => filters.tags!.some((tag) => t.tags.includes(tag)));
    }

    if (filters.query) {
      const q = filters.query.toLowerCase();
      tickets = tickets.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.customerName?.toLowerCase().includes(q) ||
          t.customerEmail?.toLowerCase().includes(q)
      );
    }

    if (filters.createdAfter) {
      tickets = tickets.filter((t) => t.createdAt >= filters.createdAfter!);
    }

    if (filters.createdBefore) {
      tickets = tickets.filter((t) => t.createdAt <= filters.createdBefore!);
    }

    // Sort by updatedAt desc
    tickets.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Apply pagination
    const offset = filters.offset || 0;
    const limit = filters.limit || 20;
    return tickets.slice(offset, offset + limit);
  }

  async createTicket(data: Partial<Ticket>): Promise<Ticket> {
    const now = new Date();
    const id = uuidv4();
    const number = this.store.nextTicketNumber++;

    const ticket: Ticket = {
      id,
      number,
      title: data.title || 'Новый тикет',
      description: data.description || '',
      status: data.status || 'new',
      priority: data.priority || 'normal',
      customerId: data.customerId,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone,
      assigneeId: data.assigneeId,
      assigneeName: data.assigneeName,
      tags: data.tags || [],
      createdAt: now,
      updatedAt: now,
      notes: [],
    };

    this.store.tickets[id] = ticket;
    this.saveStore();

    // Update customer's lastTicketAt
    if (data.customerId && this.store.customers[data.customerId]) {
      this.store.customers[data.customerId].lastTicketAt = now;
      this.store.customers[data.customerId].ticketCount++;
      this.saveStore();
    }

    return ticket;
  }

  async updateTicket(id: string, data: Partial<Ticket>): Promise<Ticket> {
    const ticket = this.store.tickets[id];
    if (!ticket) {
      throw new Error(`Ticket ${id} not found`);
    }

    const wasOpen = ['new', 'open', 'pending'].includes(ticket.status);

    // Update fields
    Object.assign(ticket, data, { updatedAt: new Date() });

    // Set closedAt if status changed to closed/resolved
    const isNowClosed = ['resolved', 'closed'].includes(ticket.status);
    if (!wasOpen && isNowClosed && !ticket.closedAt) {
      ticket.closedAt = new Date();
    }

    this.saveStore();
    return ticket;
  }

  async addTicketNote(
    ticketId: string,
    note: Omit<TicketNote, 'id' | 'ticketId' | 'createdAt'>
  ): Promise<TicketNote> {
    const ticket = this.store.tickets[ticketId];
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const ticketNote: TicketNote = {
      ...note,
      id: uuidv4(),
      ticketId,
      createdAt: new Date(),
    };

    ticket.notes.push(ticketNote);
    ticket.updatedAt = new Date();
    this.saveStore();

    return ticketNote;
  }

  // ============ CUSTOMERS ============

  async getCustomer(id: string): Promise<Customer | null> {
    return this.store.customers[id] || null;
  }

  async searchCustomers(filters: CustomerSearchFilters): Promise<Customer[]> {
    let customers = Object.values(this.store.customers);

    if (filters.query) {
      const q = filters.query.toLowerCase();
      customers = customers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phone?.includes(q)
      );
    }

    if (filters.tags && filters.tags.length > 0) {
      customers = customers.filter((c) => filters.tags!.some((tag) => c.tags.includes(tag)));
    }

    // Sort by updatedAt desc
    customers.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Apply pagination
    const offset = filters.offset || 0;
    const limit = filters.limit || 20;
    return customers.slice(offset, offset + limit);
  }

  async createCustomer(data: Partial<Customer>): Promise<Customer> {
    const now = new Date();
    const id = uuidv4();

    const customer: Customer = {
      id,
      name: data.name || 'Новый клиент',
      email: data.email,
      phone: data.phone,
      notes: data.notes || '',
      tags: data.tags || [],
      createdAt: now,
      updatedAt: now,
      ticketCount: 0,
    };

    this.store.customers[id] = customer;
    this.saveStore();

    return customer;
  }

  async updateCustomer(id: string, data: Partial<Customer>): Promise<Customer> {
    const customer = this.store.customers[id];
    if (!customer) {
      throw new Error(`Customer ${id} not found`);
    }

    Object.assign(customer, data, { updatedAt: new Date() });
    this.saveStore();

    return customer;
  }

  async getCustomerTickets(customerId: string, limit: number = 10): Promise<Ticket[]> {
    return this.searchTickets({ customerId, limit });
  }

  // ============ STATS ============

  async getStats(): Promise<{
    totalTickets: number;
    openTickets: number;
    totalCustomers: number;
  }> {
    const tickets = Object.values(this.store.tickets);
    const openStatuses: TicketStatus[] = ['new', 'open', 'pending'];

    return {
      totalTickets: tickets.length,
      openTickets: tickets.filter((t) => openStatuses.includes(t.status)).length,
      totalCustomers: Object.keys(this.store.customers).length,
    };
  }
}
