import express from 'express';

export function Widget() {
  return <div>{String(typeof express)}</div>;
}
