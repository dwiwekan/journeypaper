// Picks where papers live: our API when config.js names one, otherwise this browser.
import { API_BASE } from '../config.js';
import { Store as LocalStore } from './store.js';
import { Store as ApiStore } from './api-store.js';

export const usingApi = !!API_BASE;
export const Store = usingApi ? ApiStore : LocalStore;
