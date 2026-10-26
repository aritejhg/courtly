export function shouldReplaceDeletedDuplicate(existing, candidate) {
  return existing?.status === 'deleted' && candidate?.status !== 'deleted';
}
