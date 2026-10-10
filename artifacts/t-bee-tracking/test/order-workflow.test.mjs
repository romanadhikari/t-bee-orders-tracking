import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canShowDeliveryContact,
  getTimelineProgress,
  partitionOrders,
  telephoneHref,
} from '../src/order-workflow.ts';

const statusCases = [
  ['pending', 1, 0, 1],
  ['verified', 2, 1, 2],
  ['confirmed', 3, 2, 3],
  ['processing', 3, 2, 3],
  ['ready_for_dispatch', 4, 3, 4],
  ['shipped', 4, 4, 4],
  ['out_for_delivery', 5, 4, 5],
  ['delivered', 6, 6, 6],
  ['cancelled', null, 0, 0],
];

for (const [status, currentIndex, completedThrough, progressTarget] of statusCases) {
  test(`timeline progress reflects ${status}`, () => {
    assert.deepEqual(getTimelineProgress(status), {
      currentIndex,
      completedThrough,
      progressTarget,
    });
  });
}

test('cancelled orders retain only progress reached before cancellation', () => {
  assert.deepEqual(getTimelineProgress('cancelled', 'processing'), {
    currentIndex: null,
    completedThrough: 2,
    progressTarget: 2,
  });
  assert.deepEqual(getTimelineProgress('cancelled', 'delivered'), {
    currentIndex: null,
    completedThrough: 6,
    progressTarget: 6,
  });
});

test('delivery contact is available only during out-for-delivery', () => {
  for (const [status] of statusCases) {
    assert.equal(canShowDeliveryContact(status), status === 'out_for_delivery');
  }
  assert.equal(telephoneHref('+977 9825933188'), 'tel:+9779825933188');
});

test('delivered orders move to completed and reopened orders return to received', () => {
  const orders = statusCases.map(([status], index) => ({ id: index, status }));
  const sections = partitionOrders(orders);

  assert.equal(sections.received.length + sections.completed.length, orders.length);
  assert.deepEqual(sections.completed.map(order => order.status), ['delivered']);
  assert.equal(sections.received.some(order => order.status === 'delivered'), false);

  const reopened = { id: 'reopened', status: 'processing' };
  assert.deepEqual(partitionOrders([reopened]), {
    received: [reopened],
    completed: [],
  });
});
