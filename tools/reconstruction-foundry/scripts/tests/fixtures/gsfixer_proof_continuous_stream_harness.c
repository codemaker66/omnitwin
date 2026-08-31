#define main gsfixer_supervisor_production_main
#include "../../../native/grand_hall_gsfixer_supervisor.c"
#undef main

int main(void) {
  /*
   * /dev/zero is a deterministic continuously readable byte stream. It models
   * a writer that never permits the proof descriptor to reach EAGAIN, which is
   * the exact case that defeated a deadline checked only after EAGAIN.
   */
  int proof_descriptor = open("/dev/zero", O_RDONLY | O_CLOEXEC);
  if (proof_descriptor < 0) {
    return 10;
  }
  long long started = monotonic_milliseconds();
  struct completion_proof_observation proof =
      read_completion_proof_stream(proof_descriptor, 50);
  long long elapsed = monotonic_milliseconds() - started;
  close(proof_descriptor);

  bool valid = proof.stream_closed && proof.size == COMPLETION_PROOF_BYTES;
  int exit_code = valid ? 0 : 126;
  printf(
      "{\"completionProofBytesObserved\":%zu,\"completionProofStreamClosed\":%s,"
      "\"completionProofValid\":%s,\"elapsedMilliseconds\":%lld,\"exitCode\":%d}\n",
      proof.size,
      proof.stream_closed ? "true" : "false",
      valid ? "true" : "false",
      elapsed,
      exit_code);
  return exit_code == 126 && !proof.stream_closed &&
          proof.size == COMPLETION_PROOF_BYTES + 1U && !valid &&
          elapsed >= 50LL && elapsed < 1000LL
      ? 0
      : 11;
}
