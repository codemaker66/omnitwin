#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/memfd.h>
#include <limits.h>
#include <openssl/evp.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/random.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define PROTOCOL "venviewer.grand-hall.gsfixer-supervisor.v2"
#define EXPECTED_PYTHON_PATH "/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/runtime-py312-cu128-v1/venv/bin/python"
#define EXPECTED_PYTHON_LINK "/usr/bin/python3"
#define EXPECTED_PYTHON_SHA256 "1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118"
#define EXPECTED_PYTHON_SIZE 8020928LL
#ifndef EXPECTED_ADAPTER_SHA256
#define EXPECTED_ADAPTER_SHA256 "8c359df43135b7e10b78d1c140c49700350feeca4db32ea002a7fe9bc98d3d42"
#endif
#ifndef EXPECTED_ADAPTER_SIZE
#define EXPECTED_ADAPTER_SIZE 77721LL
#endif
#define RECEIPT_PARENT "/mnt/f/venviewer-provider-cache/gsfix3d/supervisor-runs"
#define ATTEMPT_PARENT "/mnt/f/venviewer-provider-cache/gsfix3d/runs"
#define MAX_ADAPTER_BYTES (16U * 1024U * 1024U)
#define COMPLETION_PROOF_BYTES 37U
#define RECEIPT_BUFFER_BYTES 16384U

extern char **environ;

static bool json_safe(const char *value);
static void fail(const char *message);
static volatile sig_atomic_t active_child_process_group = -1;

static void kill_child_process_group(pid_t child) {
  if (child > 0) {
    (void)kill(-child, SIGKILL);
    (void)kill(child, SIGKILL);
  }
}

static void terminate_for_signal(int signal_number) {
  kill_child_process_group((pid_t)active_child_process_group);
  _exit(128 + signal_number);
}

static void install_parent_cleanup_handlers(void) {
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = terminate_for_signal;
  sigemptyset(&action.sa_mask);
  for (size_t index = 0; index < 4U; ++index) {
    const int signal_number[] = {SIGHUP, SIGINT, SIGQUIT, SIGTERM};
    if (sigaction(signal_number[index], &action, NULL) != 0) {
      fail("could not install a supervisor cleanup signal handler");
    }
  }
}

static void reset_child_signal_handlers(void) {
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = SIG_DFL;
  sigemptyset(&action.sa_mask);
  for (size_t index = 0; index < 4U; ++index) {
    const int signal_number[] = {SIGHUP, SIGINT, SIGQUIT, SIGTERM};
    if (sigaction(signal_number[index], &action, NULL) != 0) {
      _exit(125);
    }
  }
}

struct file_identity {
  dev_t device;
  ino_t inode;
  off_t size;
  struct timespec modified;
  struct timespec changed;
};

static void fail(const char *message) {
  fprintf(stderr, "grand-hall-supervisor failed: %s: %s\n", message, strerror(errno));
  exit(125);
}

static void fail_message(const char *message) {
  fprintf(stderr, "grand-hall-supervisor failed: %s\n", message);
  exit(125);
}

static struct file_identity identity_from_stat(const struct stat *metadata) {
  struct file_identity result = {
      .device = metadata->st_dev,
      .inode = metadata->st_ino,
      .size = metadata->st_size,
      .modified = metadata->st_mtim,
      .changed = metadata->st_ctim,
  };
  return result;
}

static bool identity_equal(struct file_identity left, struct file_identity right) {
  return left.device == right.device && left.inode == right.inode &&
         left.size == right.size && left.modified.tv_sec == right.modified.tv_sec &&
         left.modified.tv_nsec == right.modified.tv_nsec &&
         left.changed.tv_sec == right.changed.tv_sec &&
         left.changed.tv_nsec == right.changed.tv_nsec;
}

static bool same_directory_object(const struct stat *left, const struct stat *right) {
  return S_ISDIR(left->st_mode) && S_ISDIR(right->st_mode) &&
         left->st_dev == right->st_dev && left->st_ino == right->st_ino;
}

static void digest_to_hex(const unsigned char digest[32], char output[65]) {
  static const char alphabet[] = "0123456789abcdef";
  for (size_t index = 0; index < 32; ++index) {
    output[index * 2] = alphabet[digest[index] >> 4];
    output[index * 2 + 1] = alphabet[digest[index] & 15U];
  }
  output[64] = '\0';
}

static void sha256_memory(const unsigned char *payload, size_t size, char output[65]) {
  unsigned char digest[EVP_MAX_MD_SIZE];
  unsigned int digest_size = 0;
  if (EVP_Digest(payload, size, digest, &digest_size, EVP_sha256(), NULL) != 1 ||
      digest_size != 32U) {
    fail_message("OpenSSL could not hash an in-memory payload");
  }
  digest_to_hex(digest, output);
}

static void sha256_fd(int descriptor, char output[65], off_t *observed_size) {
  EVP_MD_CTX *context = EVP_MD_CTX_new();
  if (context == NULL || EVP_DigestInit_ex(context, EVP_sha256(), NULL) != 1) {
    fail_message("OpenSSL could not initialise SHA-256");
  }
  unsigned char buffer[1024U * 1024U];
  off_t offset = 0;
  for (;;) {
    ssize_t count = pread(descriptor, buffer, sizeof(buffer), offset);
    if (count < 0) {
      EVP_MD_CTX_free(context);
      fail("could not read a file for SHA-256");
    }
    if (count == 0) {
      break;
    }
    if (EVP_DigestUpdate(context, buffer, (size_t)count) != 1) {
      EVP_MD_CTX_free(context);
      fail_message("OpenSSL could not update SHA-256");
    }
    offset += count;
  }
  unsigned char digest[EVP_MAX_MD_SIZE];
  unsigned int digest_size = 0;
  if (EVP_DigestFinal_ex(context, digest, &digest_size) != 1 || digest_size != 32U) {
    EVP_MD_CTX_free(context);
    fail_message("OpenSSL could not finalise SHA-256");
  }
  EVP_MD_CTX_free(context);
  digest_to_hex(digest, output);
  *observed_size = offset;
}

static void sha256_argv(char **values, int count, char output[65]) {
  EVP_MD_CTX *context = EVP_MD_CTX_new();
  if (context == NULL || EVP_DigestInit_ex(context, EVP_sha256(), NULL) != 1) {
    fail_message("OpenSSL could not initialise the adapter-argv digest");
  }
  static const unsigned char domain[] = "VENVIEWER_GSFIXER_ADAPTER_ARGV_V1\0";
  if (EVP_DigestUpdate(context, domain, sizeof(domain) - 1U) != 1) {
    EVP_MD_CTX_free(context);
    fail_message("OpenSSL could not bind the adapter-argv domain");
  }
  for (int index = 0; index < count; ++index) {
    size_t size = strlen(values[index]);
    unsigned char encoded_size[8];
    for (size_t byte = 0; byte < sizeof(encoded_size); ++byte) {
      encoded_size[sizeof(encoded_size) - 1U - byte] =
          (unsigned char)((uint64_t)size >> (byte * 8U));
    }
    if (EVP_DigestUpdate(context, encoded_size, sizeof(encoded_size)) != 1 ||
        EVP_DigestUpdate(context, values[index], size) != 1) {
      EVP_MD_CTX_free(context);
      fail_message("OpenSSL could not hash the adapter argv");
    }
  }
  unsigned char digest[EVP_MAX_MD_SIZE];
  unsigned int digest_size = 0;
  if (EVP_DigestFinal_ex(context, digest, &digest_size) != 1 || digest_size != 32U) {
    EVP_MD_CTX_free(context);
    fail_message("OpenSSL could not finalise the adapter-argv digest");
  }
  EVP_MD_CTX_free(context);
  digest_to_hex(digest, output);
}

struct adapter_arguments {
  const char *command;
  const char *source_root;
  const char *model_root;
  const char *input;
  const char *manifest;
  const char *publication_receipt;
  const char *goal_file;
  const char *attempt_directory;
  int count;
  char completion_tag;
};

struct pinned_child {
  int parent_descriptor;
  char name[NAME_MAX + 1];
  char path[PATH_MAX];
};

static void require_canonical_existing(const char *path, const char *label) {
  char resolved[PATH_MAX];
  if (!json_safe(path) || realpath(path, resolved) == NULL || strcmp(path, resolved) != 0) {
    fprintf(stderr, "grand-hall-supervisor failed: %s is not an exact canonical existing path\n", label);
    exit(125);
  }
}

static struct pinned_child require_fresh_direct_child(
    const char *parent,
    const char *supplied,
    const char *label) {
  size_t parent_size = strlen(parent);
  if (!json_safe(supplied) || strncmp(supplied, parent, parent_size) != 0 ||
      supplied[parent_size] != '/' || supplied[parent_size + 1U] == '\0') {
    fprintf(stderr, "grand-hall-supervisor failed: %s must be one direct child of %s\n", label, parent);
    exit(125);
  }
  const char *name = supplied + parent_size + 1U;
  size_t name_size = strlen(name);
  if (name_size > NAME_MAX || strchr(name, '/') != NULL || strcmp(name, ".") == 0 ||
      strcmp(name, "..") == 0) {
    fprintf(stderr, "grand-hall-supervisor failed: %s child name is not exact\n", label);
    exit(125);
  }
  char resolved_parent[PATH_MAX];
  struct stat parent_path_metadata;
  struct stat parent_descriptor_metadata;
  if (realpath(parent, resolved_parent) == NULL || strcmp(parent, resolved_parent) != 0 ||
      lstat(parent, &parent_path_metadata) != 0 || !S_ISDIR(parent_path_metadata.st_mode) ||
      S_ISLNK(parent_path_metadata.st_mode)) {
    fprintf(stderr, "grand-hall-supervisor failed: pinned %s parent is not a direct canonical directory\n", label);
    exit(125);
  }
  int parent_descriptor = open(parent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (parent_descriptor < 0 || fstat(parent_descriptor, &parent_descriptor_metadata) != 0 ||
      !identity_equal(
          identity_from_stat(&parent_path_metadata),
          identity_from_stat(&parent_descriptor_metadata))) {
    fail("could not bind a pinned output parent");
  }
  struct stat child_metadata;
  if (fstatat(parent_descriptor, name, &child_metadata, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT) {
    close(parent_descriptor);
    fprintf(stderr, "grand-hall-supervisor failed: %s target is not fresh\n", label);
    exit(125);
  }
  struct pinned_child result = {.parent_descriptor = parent_descriptor};
  int name_count = snprintf(result.name, sizeof(result.name), "%s", name);
  int path_count = snprintf(result.path, sizeof(result.path), "%s/%s", parent, name);
  if (name_count <= 0 || (size_t)name_count >= sizeof(result.name) || path_count <= 0 ||
      (size_t)path_count >= sizeof(result.path) || strcmp(result.path, supplied) != 0) {
    close(parent_descriptor);
    fail_message("could not preserve a pinned output target");
  }
  return result;
}

static struct stat require_bound_child_directory(
    int parent_descriptor,
    const char *name,
    int child_descriptor,
    const char *path,
    const char *label) {
  struct stat descriptor_metadata;
  struct stat parent_entry_metadata;
  struct stat path_metadata;
  char resolved[PATH_MAX];
  if (fstat(child_descriptor, &descriptor_metadata) != 0 ||
      fstatat(parent_descriptor, name, &parent_entry_metadata, AT_SYMLINK_NOFOLLOW) != 0 ||
      lstat(path, &path_metadata) != 0 || realpath(path, resolved) == NULL) {
    fprintf(stderr, "grand-hall-supervisor failed: could not re-attest %s\n", label);
    exit(125);
  }
  if (!same_directory_object(&descriptor_metadata, &parent_entry_metadata) ||
      !same_directory_object(&descriptor_metadata, &path_metadata) ||
      S_ISLNK(path_metadata.st_mode) || strcmp(path, resolved) != 0) {
    fprintf(stderr, "grand-hall-supervisor failed: %s path no longer names its bound directory\n", label);
    exit(125);
  }
  return descriptor_metadata;
}

static bool component_paths_overlap(const char *left, const char *right) {
  size_t left_size = strlen(left);
  size_t right_size = strlen(right);
  if (strcmp(left, right) == 0) {
    return true;
  }
  return (left_size < right_size && strncmp(left, right, left_size) == 0 && right[left_size] == '/') ||
         (right_size < left_size && strncmp(left, right, right_size) == 0 && left[right_size] == '/');
}

static void exact_parent_path(const char *path, char output[PATH_MAX]) {
  const char *separator = strrchr(path, '/');
  if (separator == NULL || separator == path) {
    fail_message("protected material path has no exact non-root parent");
  }
  size_t size = (size_t)(separator - path);
  if (size >= PATH_MAX) {
    fail_message("protected material parent exceeded PATH_MAX");
  }
  memcpy(output, path, size);
  output[size] = '\0';
}

static void require_output_disjointness(
    const struct pinned_child *receipt,
    const struct pinned_child *attempt,
    const struct adapter_arguments *arguments) {
  char input_parent[PATH_MAX];
  char manifest_parent[PATH_MAX];
  char publication_parent[PATH_MAX];
  char goal_parent[PATH_MAX];
  exact_parent_path(arguments->input, input_parent);
  exact_parent_path(arguments->manifest, manifest_parent);
  exact_parent_path(arguments->publication_receipt, publication_parent);
  exact_parent_path(arguments->goal_file, goal_parent);
  const char *protected[] = {
      arguments->source_root,
      arguments->model_root,
      input_parent,
      manifest_parent,
      publication_parent,
      goal_parent,
  };
  const char *outputs[] = {
      receipt->path,
      attempt->parent_descriptor >= 0 ? attempt->path : NULL,
  };
  for (size_t output_index = 0; output_index < sizeof(outputs) / sizeof(outputs[0]); ++output_index) {
    if (outputs[output_index] == NULL) {
      continue;
    }
    for (size_t protected_index = 0;
         protected_index < sizeof(protected) / sizeof(protected[0]);
         ++protected_index) {
      if (component_paths_overlap(outputs[output_index], protected[protected_index])) {
        fail_message("supervisor output overlaps protected source, model, lineage, input, or goal material");
      }
    }
  }
  if (outputs[1] != NULL && component_paths_overlap(outputs[0], outputs[1])) {
    fail_message("supervisor receipt and attempt directories overlap");
  }
}

static struct adapter_arguments parse_adapter_arguments(int argc, char **argv, int separator) {
  int count = argc - separator - 1;
  if (count != 13 && count != 15) {
    fail_message("adapter command has the wrong exact argument count");
  }
  char **values = argv + separator + 1;
  bool preflight = strcmp(values[0], "preflight") == 0;
  bool run = strcmp(values[0], "run") == 0;
  if ((!preflight && !run) || (preflight && count != 13) || (run && count != 15) ||
      strcmp(values[1], "--source-root") != 0 || strcmp(values[3], "--model-root") != 0 ||
      strcmp(values[5], "--input") != 0 || strcmp(values[7], "--input-pack-manifest") != 0 ||
      strcmp(values[9], "--input-pack-publication-receipt") != 0 ||
      strcmp(values[11], "--goal-file") != 0 ||
      (run && strcmp(values[13], "--attempt-dir") != 0)) {
    fail_message("adapter command does not match the audited exact schema and ordering");
  }
  for (int index = 2; index < count; index += 2) {
    if (!json_safe(values[index])) {
      fail_message("adapter material paths must be absolute JSON-safe strings");
    }
  }
  struct adapter_arguments parsed = {
      .command = values[0],
      .source_root = values[2],
      .model_root = values[4],
      .input = values[6],
      .manifest = values[8],
      .publication_receipt = values[10],
      .goal_file = values[12],
      .attempt_directory = run ? values[14] : NULL,
      .count = count,
      .completion_tag = preflight ? 'P' : 'R',
  };
  require_canonical_existing(parsed.source_root, "source root");
  require_canonical_existing(parsed.model_root, "model root");
  require_canonical_existing(parsed.input, "input image");
  require_canonical_existing(parsed.manifest, "input-pack manifest");
  require_canonical_existing(parsed.publication_receipt, "input-pack publication receipt");
  require_canonical_existing(parsed.goal_file, "active goal file");
  return parsed;
}

static bool json_safe(const char *value) {
  if (value == NULL || value[0] != '/') {
    return false;
  }
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor != 0; ++cursor) {
    if (*cursor < 0x20U || *cursor == '"' || *cursor == '\\') {
      return false;
    }
  }
  return true;
}

static int direct_regular_file(const char *path, struct stat *metadata) {
  struct stat path_metadata;
  if (lstat(path, &path_metadata) != 0) {
    fail("could not inspect a required file");
  }
  if (!S_ISREG(path_metadata.st_mode) || S_ISLNK(path_metadata.st_mode)) {
    fail_message("required files must be direct regular files");
  }
  int descriptor = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (descriptor < 0 || fstat(descriptor, metadata) != 0) {
    fail("could not open a required direct regular file");
  }
  if (!identity_equal(identity_from_stat(&path_metadata), identity_from_stat(metadata))) {
    fail_message("required file identity changed while it was opened");
  }
  return descriptor;
}

static unsigned char *read_exact_execution_file(
    int descriptor,
    struct stat before,
    size_t *size,
    char digest[65],
    const char *label) {
  if (before.st_size <= 0 || before.st_size > (off_t)MAX_ADAPTER_BYTES) {
    fail_message(label);
  }
  unsigned char *payload = malloc((size_t)before.st_size);
  if (payload == NULL) {
    fail("could not allocate an exact execution snapshot");
  }
  size_t offset = 0;
  while (offset < (size_t)before.st_size) {
    ssize_t count = pread(descriptor, payload + offset, (size_t)before.st_size - offset, (off_t)offset);
    if (count <= 0) {
      free(payload);
      fail("could not read exact execution bytes");
    }
    offset += (size_t)count;
  }
  struct stat after;
  if (fstat(descriptor, &after) != 0 ||
      !identity_equal(identity_from_stat(&before), identity_from_stat(&after))) {
    free(payload);
    fail_message("execution source changed while it was snapshotted");
  }
  sha256_memory(payload, offset, digest);
  *size = offset;
  return payload;
}

static int sealed_memfd(const char *name, const unsigned char *payload, size_t size) {
  int descriptor = memfd_create(name, MFD_ALLOW_SEALING);
  if (descriptor < 0) {
    fail("could not create the sealed adapter memory file");
  }
  size_t offset = 0;
  while (offset < size) {
    ssize_t count = write(descriptor, payload + offset, size - offset);
    if (count <= 0) {
      fail("could not write the sealed adapter memory file");
    }
    offset += (size_t)count;
  }
  if (fchmod(descriptor, 0500) != 0) {
    fail("could not set the sealed execution image mode");
  }
  int seals = F_SEAL_SEAL | F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE;
  if (fcntl(descriptor, F_ADD_SEALS, seals) != 0 || fcntl(descriptor, F_GET_SEALS) != seals) {
    fail("could not irrevocably seal the adapter memory file");
  }
  int flags = fcntl(descriptor, F_GETFD);
  if (flags < 0 || fcntl(descriptor, F_SETFD, flags & ~FD_CLOEXEC) != 0) {
    fail("could not make the sealed adapter descriptor inheritable");
  }
  return descriptor;
}

static void write_all(int descriptor, const char *payload, size_t size) {
  size_t offset = 0;
  while (offset < size) {
    ssize_t count = write(descriptor, payload + offset, size - offset);
    if (count <= 0) {
      fail("could not write a detached supervisor receipt");
    }
    offset += (size_t)count;
  }
  if (fsync(descriptor) != 0) {
    fail("could not sync a detached supervisor receipt");
  }
}

static void write_create_only_at(int directory, const char *name, const char *payload, size_t size) {
  int descriptor = openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (descriptor < 0) {
    fail("detached supervisor receipt is not create-only");
  }
  write_all(descriptor, payload, size);
  if (close(descriptor) != 0) {
    fail("could not close a detached supervisor receipt");
  }
}

static void set_environment_number(const char *name, long long value) {
  char buffer[64];
  int count = snprintf(buffer, sizeof(buffer), "%lld", value);
  if (count <= 0 || (size_t)count >= sizeof(buffer) || setenv(name, buffer, 1) != 0) {
    fail("could not bind numeric supervisor environment evidence");
  }
}

static void set_environment_string(const char *name, const char *value) {
  if (setenv(name, value, 1) != 0) {
    fail("could not bind supervisor environment evidence");
  }
}

static void install_fixed_child_environment(void) {
  if (clearenv() != 0) {
    fail("could not clear the inherited environment");
  }
  umask(0077);
  static const struct {
    const char *name;
    const char *value;
  } fixed[] = {
      {"CUBLAS_WORKSPACE_CONFIG", ":4096:8"},
      {"DIFFUSERS_OFFLINE", "1"},
      {"HF_DATASETS_OFFLINE", "1"},
      {"HF_HUB_DISABLE_IMPLICIT_TOKEN", "1"},
      {"HF_HUB_DISABLE_TELEMETRY", "1"},
      {"HF_HUB_OFFLINE", "1"},
      {"HOME", "/nonexistent"},
      {"LANG", "C.UTF-8"},
      {"LC_ALL", "C.UTF-8"},
      {"PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/wsl/lib"},
      {"PIP_NO_INDEX", "1"},
      {"PYTHONDONTWRITEBYTECODE", "1"},
      {"PYTHONHASHSEED", "0"},
      {"PYTHONNOUSERSITE", "1"},
      {"TMPDIR", "/tmp"},
      {"TRANSFORMERS_OFFLINE", "1"},
      {"TZ", "UTC"},
  };
  for (size_t index = 0; index < sizeof(fixed) / sizeof(fixed[0]); ++index) {
    set_environment_string(fixed[index].name, fixed[index].value);
  }
}

static void close_inherited_descriptors(void) {
  for (int descriptor = STDIN_FILENO; descriptor <= STDERR_FILENO; ++descriptor) {
    struct stat metadata;
    if (fstat(descriptor, &metadata) != 0 || S_ISSOCK(metadata.st_mode)) {
      fail_message("standard descriptors must exist and must not be inherited sockets");
    }
  }
  if (close_range(3U, ~0U, 0) != 0) {
    fail("could not close inherited non-standard descriptors");
  }
}

static long long unix_nanoseconds(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_REALTIME, &value) != 0) {
    fail("could not read the supervisor clock");
  }
  return (long long)value.tv_sec * 1000000000LL + value.tv_nsec;
}

static long long monotonic_milliseconds(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) {
    fail("could not read the monotonic clock");
  }
  return (long long)value.tv_sec * 1000LL + value.tv_nsec / 1000000LL;
}

struct completion_proof_observation {
  unsigned char bytes[COMPLETION_PROOF_BYTES + 1U];
  size_t size;
  bool stream_closed;
};

static struct completion_proof_observation read_completion_proof_stream(
    int descriptor,
    int timeout_milliseconds) {
  struct completion_proof_observation observation = {.size = 0, .stream_closed = false};
  int read_flags = fcntl(descriptor, F_GETFL);
  if (read_flags < 0 || fcntl(descriptor, F_SETFL, read_flags | O_NONBLOCK) != 0) {
    fail("could not make the adapter completion proof nonblocking");
  }
  long long deadline = monotonic_milliseconds() + timeout_milliseconds;
  struct pollfd proof_poll = {.fd = descriptor, .events = POLLIN | POLLHUP};
  unsigned char overflow[256];
  while (!observation.stream_closed) {
    if (monotonic_milliseconds() >= deadline) {
      break;
    }
    size_t remaining_capacity = sizeof(observation.bytes) - observation.size;
    unsigned char *target = remaining_capacity > 0U
        ? observation.bytes + observation.size
        : overflow;
    size_t requested = remaining_capacity > 0U ? remaining_capacity : sizeof(overflow);
    ssize_t count = read(descriptor, target, requested);
    if (count > 0) {
      if (remaining_capacity > 0U) {
        observation.size += (size_t)count;
      }
      continue;
    }
    if (count == 0) {
      observation.stream_closed = true;
      break;
    }
    if (errno != EAGAIN && errno != EWOULDBLOCK) {
      fail("could not read the adapter completion proof");
    }
    long long remaining = deadline - monotonic_milliseconds();
    if (remaining <= 0LL) {
      break;
    }
    proof_poll.revents = 0;
    int poll_result;
    do {
      poll_result = poll(&proof_poll, 1, remaining > INT_MAX ? INT_MAX : (int)remaining);
    } while (poll_result < 0 && errno == EINTR);
    if (poll_result < 0) {
      fail("could not poll the adapter completion proof");
    }
    if (poll_result == 0) {
      break;
    }
  }
  return observation;
}

static void random_bytes(unsigned char *output, size_t size) {
  size_t offset = 0;
  while (offset < size) {
    ssize_t count = getrandom(output + offset, size - offset, 0);
    if (count <= 0) {
      fail("could not create the supervisor completion nonce");
    }
    offset += (size_t)count;
  }
}

int main(int argc, char **argv) {
  const char *python = NULL;
  const char *adapter = NULL;
  const char *receipt_directory = NULL;
  int separator = -1;
  for (int index = 1; index < argc; ++index) {
    if (strcmp(argv[index], "--") == 0) {
      separator = index;
      break;
    }
    if (index + 1 >= argc) {
      fail_message("supervisor options require values");
    }
    if (strcmp(argv[index], "--python") == 0) {
      python = argv[++index];
    } else if (strcmp(argv[index], "--adapter") == 0) {
      adapter = argv[++index];
    } else if (strcmp(argv[index], "--receipt-dir") == 0) {
      receipt_directory = argv[++index];
    } else {
      fail_message("unknown supervisor option");
    }
  }
  if (python == NULL || adapter == NULL || receipt_directory == NULL || separator < 0 ||
      separator + 1 >= argc || !json_safe(python) || !json_safe(adapter) ||
      !json_safe(receipt_directory)) {
    fail_message("absolute safe --python, --adapter, --receipt-dir and adapter command are required");
  }

  struct adapter_arguments adapter_arguments = parse_adapter_arguments(argc, argv, separator);
  install_fixed_child_environment();
  close_inherited_descriptors();
  struct pinned_child receipt_target = require_fresh_direct_child(
      RECEIPT_PARENT,
      receipt_directory,
      "receipt directory");
  struct pinned_child attempt_target = {.parent_descriptor = -1};
  if (adapter_arguments.attempt_directory != NULL) {
    attempt_target = require_fresh_direct_child(
        ATTEMPT_PARENT,
        adapter_arguments.attempt_directory,
        "attempt directory");
  }
  require_output_disjointness(&receipt_target, &attempt_target, &adapter_arguments);
  char adapter_argv_digest[65];
  sha256_argv(argv + separator + 1, adapter_arguments.count, adapter_argv_digest);

  char exact_python[4096];
  char resolved_adapter[4096];
  int python_count = snprintf(exact_python, sizeof(exact_python), "%s", python);
  if (python_count <= 0 || (size_t)python_count >= sizeof(exact_python) ||
      realpath(adapter, resolved_adapter) == NULL || !json_safe(exact_python) ||
      !json_safe(resolved_adapter)) {
    fail("could not preserve the Python environment path or resolve the adapter path");
  }
  if (strcmp(exact_python, EXPECTED_PYTHON_PATH) != 0) {
    fail_message("Python entrypoint is not the exact sealed runtime path");
  }
  struct stat python_link_metadata;
  if (lstat(exact_python, &python_link_metadata) != 0 || !S_ISLNK(python_link_metadata.st_mode)) {
    fail_message("sealed runtime Python entrypoint is not the expected direct symlink");
  }
  char python_link_target[4096];
  ssize_t python_link_size = readlink(exact_python, python_link_target, sizeof(python_link_target) - 1U);
  if (python_link_size <= 0 || (size_t)python_link_size >= sizeof(python_link_target)) {
    fail("could not read the sealed runtime Python symlink");
  }
  python_link_target[python_link_size] = '\0';
  if (strcmp(python_link_target, EXPECTED_PYTHON_LINK) != 0) {
    fail_message("sealed runtime Python symlink target changed");
  }
  struct stat python_metadata;
  int python_descriptor = open(exact_python, O_RDONLY | O_CLOEXEC);
  if (python_descriptor < 0 || fstat(python_descriptor, &python_metadata) != 0 ||
      !S_ISREG(python_metadata.st_mode)) {
    fail("Python environment entrypoint does not resolve to a regular executable");
  }
  char python_digest[65];
  size_t python_size = 0;
  unsigned char *python_payload = read_exact_execution_file(
      python_descriptor,
      python_metadata,
      &python_size,
      python_digest,
      "Python executable size is outside the audited supervisor bound");
  close(python_descriptor);
  if ((long long)python_size != EXPECTED_PYTHON_SIZE ||
      strcmp(python_digest, EXPECTED_PYTHON_SHA256) != 0) {
    free(python_payload);
    fail_message("sealed runtime Python executable disagrees with its audited pin");
  }
  int python_memory_descriptor = sealed_memfd(
      "venviewer-grand-hall-python-runtime",
      python_payload,
      python_size);
  free(python_payload);

  struct stat adapter_metadata;
  int adapter_source_descriptor = direct_regular_file(resolved_adapter, &adapter_metadata);
  size_t adapter_size = 0;
  char adapter_digest[65];
  unsigned char *adapter_payload = read_exact_execution_file(
      adapter_source_descriptor,
      adapter_metadata,
      &adapter_size,
      adapter_digest,
      "adapter size is outside the audited supervisor bound");
  if ((long long)adapter_size != EXPECTED_ADAPTER_SIZE ||
      strcmp(adapter_digest, EXPECTED_ADAPTER_SHA256) != 0) {
    free(adapter_payload);
    close(adapter_source_descriptor);
    close(receipt_target.parent_descriptor);
    if (attempt_target.parent_descriptor >= 0) {
      close(attempt_target.parent_descriptor);
    }
    fail_message("adapter execution bytes disagree with the audited supervisor pin");
  }
  int adapter_memory_descriptor = sealed_memfd(
      "venviewer-grand-hall-gsfixer-adapter",
      adapter_payload,
      adapter_size);
  free(adapter_payload);

  int self_descriptor = open("/proc/self/exe", O_RDONLY | O_CLOEXEC);
  struct stat self_metadata;
  if (self_descriptor < 0 || fstat(self_descriptor, &self_metadata) != 0 ||
      !S_ISREG(self_metadata.st_mode)) {
    fail("could not bind the running supervisor executable");
  }
  char self_digest[65];
  off_t self_size = 0;
  sha256_fd(self_descriptor, self_digest, &self_size);
  if (self_size != self_metadata.st_size) {
    fail_message("running supervisor executable changed while hashed");
  }
  close(self_descriptor);

  if (mkdirat(receipt_target.parent_descriptor, receipt_target.name, 0700) != 0) {
    fail("detached supervisor receipt directory is create-only");
  }
  int receipt_directory_descriptor = openat(
      receipt_target.parent_descriptor,
      receipt_target.name,
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (receipt_directory_descriptor < 0) {
    fail("could not open the detached supervisor receipt directory");
  }
  struct stat receipt_directory_metadata = require_bound_child_directory(
      receipt_target.parent_descriptor,
      receipt_target.name,
      receipt_directory_descriptor,
      receipt_target.path,
      "detached supervisor receipt directory");
  int receipt_flags = fcntl(receipt_directory_descriptor, F_GETFD);
  if (receipt_flags < 0 ||
      fcntl(receipt_directory_descriptor, F_SETFD, receipt_flags & ~FD_CLOEXEC) != 0) {
    fail("could not make the receipt directory descriptor inheritable");
  }
  set_environment_number("VENVIEWER_GSFIXER_RECEIPT_FD", receipt_directory_descriptor);
  set_environment_string("VENVIEWER_GSFIXER_RECEIPT_PATH", receipt_target.path);
  set_environment_number(
      "VENVIEWER_GSFIXER_RECEIPT_DEVICE",
      (long long)receipt_directory_metadata.st_dev);
  set_environment_number(
      "VENVIEWER_GSFIXER_RECEIPT_INODE",
      (long long)receipt_directory_metadata.st_ino);
  int attempt_directory_descriptor = -1;
  if (attempt_target.parent_descriptor >= 0) {
    if (mkdirat(attempt_target.parent_descriptor, attempt_target.name, 0700) != 0) {
      fail("attempt directory is not create-only through its pinned parent");
    }
    attempt_directory_descriptor = openat(
        attempt_target.parent_descriptor,
        attempt_target.name,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (attempt_directory_descriptor < 0) {
      fail("could not open the create-only attempt directory");
    }
    int attempt_flags = fcntl(attempt_directory_descriptor, F_GETFD);
    if (attempt_flags < 0 ||
        fcntl(attempt_directory_descriptor, F_SETFD, attempt_flags & ~FD_CLOEXEC) != 0) {
      fail("could not make the attempt directory descriptor inheritable");
    }
    set_environment_number("VENVIEWER_GSFIXER_ATTEMPT_FD", attempt_directory_descriptor);
    set_environment_string("VENVIEWER_GSFIXER_ATTEMPT_PATH", attempt_target.path);
  }

  char started[RECEIPT_BUFFER_BYTES];
  int started_count = snprintf(
      started,
      sizeof(started),
      "{\"adapterSource\":{\"device\":%llu,\"inode\":%llu,\"path\":\"%s\",\"sha256\":\"sha256:%s\",\"sizeBytes\":%zu},"
      "\"adapterInvocation\":{\"argvCount\":%d,\"argvSha256\":\"sha256:%s\",\"command\":\"%s\",\"completionTag\":%d},"
      "\"authority\":\"none\",\"execution\":{\"adapterMemfd\":%d,\"pythonMemfd\":%d,\"seals\":15},"
      "\"python\":{\"executableSha256\":\"sha256:%s\",\"executableSizeBytes\":%lld,\"path\":\"%s\",\"symlinkTarget\":\"%s\"},"
      "\"receiptDirectory\":\"%s\",\"receiptDirectoryBinding\":{\"descriptor\":%d,\"device\":%llu,\"inode\":%llu},"
      "\"schemaVersion\":\"%s\",\"startedUnixNs\":%lld,"
      "\"status\":\"started\",\"supervisor\":{\"cryptographicExecutionProvenance\":false,\"pid\":%lld,\"provenancePosture\":\"trusted_host_diagnostic_only\",\"sha256\":\"sha256:%s\",\"sizeBytes\":%lld},"
      "\"truthLayer\":\"GENERATED_CINEMATIC\"}\n",
      (unsigned long long)adapter_metadata.st_dev,
      (unsigned long long)adapter_metadata.st_ino,
      resolved_adapter,
      adapter_digest,
      adapter_size,
      adapter_arguments.count,
      adapter_argv_digest,
      adapter_arguments.command,
      (int)adapter_arguments.completion_tag,
      adapter_memory_descriptor,
      python_memory_descriptor,
      python_digest,
      (long long)python_size,
      exact_python,
      python_link_target,
      receipt_target.path,
      receipt_directory_descriptor,
      (unsigned long long)receipt_directory_metadata.st_dev,
      (unsigned long long)receipt_directory_metadata.st_ino,
      PROTOCOL,
      unix_nanoseconds(),
      (long long)getpid(),
      self_digest,
      (long long)self_size);
  if (started_count <= 0 || (size_t)started_count >= sizeof(started)) {
    fail_message("detached started receipt exceeded its fixed bound");
  }
  write_create_only_at(receipt_directory_descriptor, "started.json", started, (size_t)started_count);
  char started_digest[65];
  sha256_memory((const unsigned char *)started, (size_t)started_count, started_digest);

  set_environment_string("VENVIEWER_GSFIXER_SUPERVISOR_PROTOCOL", PROTOCOL);
  set_environment_number("VENVIEWER_GSFIXER_SUPERVISOR_PID", (long long)getpid());
  set_environment_string("VENVIEWER_GSFIXER_SUPERVISOR_SHA256", self_digest);
  set_environment_number("VENVIEWER_GSFIXER_SUPERVISOR_SIZE", (long long)self_size);
  set_environment_string("VENVIEWER_GSFIXER_SUPERVISOR_STATIC", "1");
  set_environment_number("VENVIEWER_GSFIXER_ADAPTER_FD", adapter_memory_descriptor);
  set_environment_string("VENVIEWER_GSFIXER_ADAPTER_SHA256", adapter_digest);
  set_environment_number("VENVIEWER_GSFIXER_ADAPTER_SIZE", (long long)adapter_size);
  set_environment_string("VENVIEWER_GSFIXER_ADAPTER_SOURCE_PATH", resolved_adapter);
  set_environment_number("VENVIEWER_GSFIXER_ADAPTER_SOURCE_DEVICE", (long long)adapter_metadata.st_dev);
  set_environment_number("VENVIEWER_GSFIXER_ADAPTER_SOURCE_INODE", (long long)adapter_metadata.st_ino);
  set_environment_number("VENVIEWER_GSFIXER_PYTHON_FD", python_memory_descriptor);
  set_environment_string("VENVIEWER_GSFIXER_STARTED_RECEIPT_DIR", receipt_target.path);
  set_environment_number("VENVIEWER_GSFIXER_STARTED_RECEIPT_SIZE", started_count);
  set_environment_string("VENVIEWER_GSFIXER_STARTED_RECEIPT_SHA256", started_digest);

  int proof_pipe[2];
  if (pipe2(proof_pipe, O_CLOEXEC) != 0) {
    fail("could not create the supervisor completion-proof pipe");
  }
  int proof_flags = fcntl(proof_pipe[1], F_GETFD);
  if (proof_flags < 0 || fcntl(proof_pipe[1], F_SETFD, proof_flags & ~FD_CLOEXEC) != 0) {
    fail("could not make the completion-proof descriptor inheritable");
  }
  unsigned char completion_nonce[32];
  char completion_nonce_hex[65];
  random_bytes(completion_nonce, sizeof(completion_nonce));
  digest_to_hex(completion_nonce, completion_nonce_hex);
  set_environment_number("VENVIEWER_GSFIXER_COMPLETION_FD", proof_pipe[1]);
  set_environment_string("VENVIEWER_GSFIXER_COMPLETION_NONCE", completion_nonce_hex);
  set_environment_number(
      "VENVIEWER_GSFIXER_COMPLETION_TAG",
      (long long)adapter_arguments.completion_tag);

  int barrier[2];
  if (pipe2(barrier, O_CLOEXEC) != 0) {
    fail("could not create the supervisor execution barrier");
  }
  install_parent_cleanup_handlers();
  pid_t supervisor_pid = getpid();
  pid_t child = fork();
  if (child < 0) {
    fail("could not fork the supervised adapter process");
  }
  if (child == 0) {
    reset_child_signal_handlers();
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0 || getppid() != supervisor_pid) {
      _exit(125);
    }
    if (setpgid(0, 0) != 0) {
      _exit(125);
    }
    close(proof_pipe[0]);
    close(barrier[1]);
    char released = 0;
    if (read(barrier[0], &released, 1) != 1 || released != 'R') {
      _exit(125);
    }
    close(barrier[0]);
    char script_path[64];
    int script_count = snprintf(script_path, sizeof(script_path), "/proc/self/fd/%d", adapter_memory_descriptor);
    if (script_count <= 0 || (size_t)script_count >= sizeof(script_path)) {
      _exit(125);
    }
    int adapter_argument_count = adapter_arguments.count;
    char **child_arguments = calloc((size_t)adapter_argument_count + 6U, sizeof(char *));
    if (child_arguments == NULL) {
      _exit(125);
    }
    child_arguments[0] = exact_python;
    child_arguments[1] = "-I";
    child_arguments[2] = "-B";
    child_arguments[3] = "-S";
    child_arguments[4] = script_path;
    for (int index = 0; index < adapter_argument_count; ++index) {
      child_arguments[index + 5] = argv[separator + 1 + index];
    }
    child_arguments[adapter_argument_count + 5] = NULL;
    fexecve(python_memory_descriptor, child_arguments, environ);
    _exit(125);
  }

  active_child_process_group = (sig_atomic_t)child;
  if (setpgid(child, child) != 0 && errno != EACCES) {
    kill_child_process_group(child);
    fail("could not isolate the adapter process group");
  }
  close(proof_pipe[1]);
  close(barrier[0]);
  char release = 'R';
  if (write(barrier[1], &release, 1) != 1) {
    kill_child_process_group(child);
    fail("could not release the supervised adapter process");
  }
  close(barrier[1]);
  int child_status = 0;
  if (waitpid(child, &child_status, 0) != child) {
    kill_child_process_group(child);
    fail("could not wait for the supervised adapter process");
  }
  if (kill(-child, SIGKILL) != 0 && errno != ESRCH) {
    fail("could not terminate residual adapter descendants");
  }
  active_child_process_group = -1;

  unsigned char expected_proof[COMPLETION_PROOF_BYTES];
  memcpy(expected_proof, "VGH1", 4U);
  memcpy(expected_proof + 4U, completion_nonce, sizeof(completion_nonce));
  expected_proof[36] = (unsigned char)adapter_arguments.completion_tag;
  struct completion_proof_observation proof =
      read_completion_proof_stream(proof_pipe[0], 5000);
  close(proof_pipe[0]);
  bool completion_proof_valid =
      proof.stream_closed &&
      proof.size == COMPLETION_PROOF_BYTES &&
      memcmp(proof.bytes, expected_proof, COMPLETION_PROOF_BYTES) == 0;
  int child_exit_code =
      WIFEXITED(child_status) ? WEXITSTATUS(child_status) : 128 + WTERMSIG(child_status);
  int exit_code = child_exit_code == 0 && !completion_proof_valid ? 126 : child_exit_code;
  int terminating_signal = WIFSIGNALED(child_status) ? WTERMSIG(child_status) : 0;
  const char *outcome = exit_code == 0 ? "succeeded" : "failed";
  char terminal[RECEIPT_BUFFER_BYTES];
  int terminal_count = snprintf(
      terminal,
      sizeof(terminal),
      "{\"adapterInvocation\":{\"argvCount\":%d,\"argvSha256\":\"sha256:%s\",\"command\":\"%s\",\"completionTag\":%d},"
      "\"adapterSha256\":\"sha256:%s\",\"authority\":\"none\",\"childPid\":%lld,"
      "\"childExitCode\":%d,\"completedUnixNs\":%lld,\"completionProofStreamClosed\":%s,\"completionProofValid\":%s,"
      "\"completionProofBytesObserved\":%zu,\"exitCode\":%d,\"outcome\":\"%s\",\"receiptDirectory\":\"%s\",\"schemaVersion\":\"%s\","
      "\"startedReceipt\":{\"sha256\":\"sha256:%s\",\"sizeBytes\":%d},"
      "\"status\":\"terminal\",\"supervisor\":{\"cryptographicExecutionProvenance\":false,\"provenancePosture\":\"trusted_host_diagnostic_only\",\"sha256\":\"sha256:%s\"},"
      "\"terminatingSignal\":%d,\"truthLayer\":\"GENERATED_CINEMATIC\"}\n",
      adapter_arguments.count,
      adapter_argv_digest,
      adapter_arguments.command,
      (int)adapter_arguments.completion_tag,
      adapter_digest,
      (long long)child,
      child_exit_code,
      unix_nanoseconds(),
      proof.stream_closed ? "true" : "false",
      completion_proof_valid ? "true" : "false",
      proof.size,
      exit_code,
      outcome,
      receipt_target.path,
      PROTOCOL,
      started_digest,
      started_count,
      self_digest,
      terminating_signal);
  if (terminal_count <= 0 || (size_t)terminal_count >= sizeof(terminal)) {
    fail_message("detached terminal receipt exceeded its fixed bound");
  }
  require_bound_child_directory(
      receipt_target.parent_descriptor,
      receipt_target.name,
      receipt_directory_descriptor,
      receipt_target.path,
      "detached supervisor receipt directory before terminal publication");
  if (attempt_directory_descriptor >= 0) {
    require_bound_child_directory(
        attempt_target.parent_descriptor,
        attempt_target.name,
        attempt_directory_descriptor,
        attempt_target.path,
        "attempt directory before terminal publication");
  }
  write_create_only_at(receipt_directory_descriptor, "terminal.json", terminal, (size_t)terminal_count);

  close(receipt_target.parent_descriptor);
  close(receipt_directory_descriptor);
  if (attempt_directory_descriptor >= 0) {
    close(attempt_target.parent_descriptor);
    close(attempt_directory_descriptor);
  }
  close(python_memory_descriptor);
  close(adapter_memory_descriptor);
  close(adapter_source_descriptor);
  return exit_code;
}
