// The module registry: every module that keeps tables in the one flarealoy database, in
// registration order. The store runs their migrations in this order, and export writes their
// tables in this order.
import type { StoreModule } from '../core/store.js';
import { securityModule } from '../modules/security/core/module.js';

export const MODULES: readonly StoreModule[] = [securityModule];
