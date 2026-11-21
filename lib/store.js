'use client';

import { useSyncExternalStore } from 'react';
import { initialResources } from './mock';

const key = 'huke-library-v1';
const changed = 'huke-library-change';
const initial = { resources: initialResources, comments: {}, reports: {} };
let previousRaw;
let previousState = initial;

function snapshot() {
  const raw = localStorage.getItem(key);
  if (raw !== previousRaw) {
    previousRaw = raw;
    previousState = raw ? JSON.parse(raw) : initial;
  }
  return previousState;
}

function subscribe(listener) {
  window.addEventListener(changed, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener('storage', listener);
  };
}

export function useLibrary() {
  return useSyncExternalStore(subscribe, snapshot, () => initial);
}

export function updateLibrary(update) {
  localStorage.setItem(key, JSON.stringify(update(snapshot())));
  window.dispatchEvent(new Event(changed));
}

export function updateResource(id, update) {
  updateLibrary((state) => ({
    ...state,
    resources: state.resources.map((resource) => resource.id === id ? update(resource) : resource),
  }));
}

function fileRequest(mode, operation) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('huke-library-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('files', mode);
      const result = operation(transaction.objectStore('files'));
      transaction.oncomplete = () => { database.close(); resolve(result.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  });
}

export function saveFile(id, file) {
  return fileRequest('readwrite', (files) => files.put(file, id));
}

export function removeFile(id) {
  return fileRequest('readwrite', (files) => files.delete(id));
}

export function readFile(id) {
  return fileRequest('readonly', (files) => files.get(id));
}
