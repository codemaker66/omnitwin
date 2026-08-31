#define main gsfixer_supervisor_production_main
#include "../../../native/grand_hall_gsfixer_supervisor.c"
#undef main

static void expected_proof_bytes(unsigned char output[COMPLETION_PROOF_BYTES]) {
  memcpy(output, "VGH1", 4U);
  for (size_t index = 0; index < 32U; ++index) {
    output[index + 4U] = (unsigned char)index;
  }
  output[36] = (unsigned char)'P';
}

int main(void) {
  int proof_pipe[2];
  if (pipe(proof_pipe) != 0) {
    return 10;
  }
  pid_t direct_child = fork();
  if (direct_child < 0) {
    return 11;
  }
  if (direct_child == 0) {
    close(proof_pipe[0]);
    if (setpgid(0, 0) != 0) {
      _exit(12);
    }
    int escape_ready[2];
    if (pipe(escape_ready) != 0) {
      _exit(13);
    }
    pid_t escaped_child = fork();
    if (escaped_child < 0) {
      _exit(14);
    }
    if (escaped_child == 0) {
      close(escape_ready[0]);
      if (setsid() < 0 || write(escape_ready[1], "R", 1U) != 1) {
        _exit(15);
      }
      close(escape_ready[1]);
      struct timespec delay = {.tv_sec = 0, .tv_nsec = 250000000L};
      if (nanosleep(&delay, NULL) != 0 || write(proof_pipe[1], "X", 1U) != 1) {
        _exit(16);
      }
      close(proof_pipe[1]);
      _exit(0);
    }
    close(escape_ready[1]);
    char ready = 0;
    if (read(escape_ready[0], &ready, 1U) != 1 || ready != 'R') {
      _exit(17);
    }
    close(escape_ready[0]);
    unsigned char expected[COMPLETION_PROOF_BYTES];
    expected_proof_bytes(expected);
    if (write(proof_pipe[1], expected, sizeof(expected)) != (ssize_t)sizeof(expected)) {
      _exit(18);
    }
    close(proof_pipe[1]);
    _exit(0);
  }

  close(proof_pipe[1]);
  if (setpgid(direct_child, direct_child) != 0 && errno != EACCES) {
    return 19;
  }
  int child_status = 0;
  if (waitpid(direct_child, &child_status, 0) != direct_child ||
      !WIFEXITED(child_status) || WEXITSTATUS(child_status) != 0) {
    return 20;
  }
  if (kill(-direct_child, SIGKILL) != 0 && errno != ESRCH) {
    return 21;
  }

  struct completion_proof_observation proof =
      read_completion_proof_stream(proof_pipe[0], 2000);
  close(proof_pipe[0]);
  unsigned char expected[COMPLETION_PROOF_BYTES];
  expected_proof_bytes(expected);
  bool valid = proof.stream_closed && proof.size == COMPLETION_PROOF_BYTES &&
      memcmp(proof.bytes, expected, COMPLETION_PROOF_BYTES) == 0;
  int exit_code = valid ? 0 : 126;
  printf(
      "{\"completionProofBytesObserved\":%zu,\"completionProofStreamClosed\":%s,"
      "\"completionProofValid\":%s,\"exitCode\":%d}\n",
      proof.size,
      proof.stream_closed ? "true" : "false",
      valid ? "true" : "false",
      exit_code);
  return exit_code == 126 && proof.stream_closed && proof.size == 38U && !valid
      ? 0
      : 22;
}
