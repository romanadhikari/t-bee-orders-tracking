import type { OrderStatus } from '@workspace/api-client-react';

const currentStageByStatus: Partial<Record<OrderStatus, number>> = {
  pending: 1,
  verified: 2,
  confirmed: 3,
  processing: 3,
  ready_for_dispatch: 4,
  shipped: 4,
  out_for_delivery: 5,
  delivered: 6,
};

const completedThroughByStatus: Partial<Record<OrderStatus, number>> = {
  pending: 0,
  verified: 1,
  confirmed: 2,
  processing: 2,
  ready_for_dispatch: 3,
  shipped: 4,
  out_for_delivery: 4,
  delivered: 6,
};

export function getTimelineProgress(
  status: OrderStatus,
  lastActiveStatus: OrderStatus = 'pending',
) {
  const cancelled = status === 'cancelled';
  const progressStatus = cancelled
    ? lastActiveStatus === 'cancelled' ? 'pending' : lastActiveStatus
    : status;
  const currentIndex = cancelled
    ? null
    : currentStageByStatus[progressStatus] ?? 1;
  const completedThrough = completedThroughByStatus[progressStatus] ?? 0;

  return {
    currentIndex,
    completedThrough,
    progressTarget: status === 'delivered'
      ? 6
      : cancelled
        ? completedThrough
        : currentIndex ?? completedThrough,
  };
}

export function canShowDeliveryContact(status: OrderStatus) {
  return status === 'out_for_delivery';
}

export function telephoneHref(phone: string) {
  return `tel:${phone.replace(/\s/g, '')}`;
}

export function partitionOrders<T extends { status: OrderStatus }>(orders: readonly T[]) {
  const received: T[] = [];
  const completed: T[] = [];

  for (const order of orders) {
    (order.status === 'delivered' ? completed : received).push(order);
  }

  return { received, completed };
}
