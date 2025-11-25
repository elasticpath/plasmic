import type { ElasticPathOrder } from '../../checkout/types';

/**
 * API Schema for retrieving an order
 */
export interface GetOrderAPI {
  query: {
    orderId: string;
  };
  data: {
    order: ElasticPathOrder;
  };
}

/**
 * API Schema for retrieving order history for a customer
 */
export interface GetOrderHistoryAPI {
  query: {
    customerId?: string;
    email?: string;
    limit?: number;
    offset?: number;
  };
  data: {
    orders: ElasticPathOrder[];
    pagination: {
      limit: number;
      offset: number;
      total: number;
    };
  };
}

/**
 * API Schema for updating order status
 */
export interface UpdateOrderAPI {
  body: {
    orderId: string;
    status: string;
    notes?: string;
  };
  data: {
    order: ElasticPathOrder;
  };
}