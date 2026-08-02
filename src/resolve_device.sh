#!/usr/bin/env bash

# Description: Identifies the underlying physical block device for a given file path.
#              Supports standard filesystems and attempts to resolve ZFS pools.

set -euo pipefail

# --- Configuration & Constants ---
readonly EXIT_SUCCESS=0
readonly EXIT_ERR_GENERIC=1
readonly EXIT_ERR_ARGS=2
readonly EXIT_ERR_UNSUPPORTED=3

# --- Helper Functions ---

log_error() {
    printf "[ERROR] %s\n" "$1" >&2
}

usage() {
    echo "Usage: $0 <path>"
    echo "Resolves the underlying physical device for the given path."
}

# --- Main Logic ---

# 1. Argument Validation
if [[ $# -eq 0 ]]; then
    usage >&2
    exit "$EXIT_ERR_ARGS"
fi

readonly TARGET_PATH="$1"

if [[ ! -e "$TARGET_PATH" ]]; then
    log_error "Path '$TARGET_PATH' does not exist."
    exit "$EXIT_ERR_ARGS"
fi

# 2. OS Check
if [[ "$(uname -s)" == "Darwin" ]]; then
    # TODO: Implement accurate macOS disk resolution (e.g., using diskutil)
    printf "[WARN] macOS disk resolution not implemented; assuming disk0.\n" >&2
    echo "disk0"
    exit "$EXIT_SUCCESS"
fi

# 3. Resolve Filesystem Info
if ! FSINFO=$(findmnt -n -o FSTYPE,SOURCE --target "$TARGET_PATH" 2>/dev/null); then
    log_error "Could not determine filesystem for '$TARGET_PATH'."
    exit "$EXIT_ERR_GENERIC"
fi
read -r FSTYPE MOUNT_SOURCE <<< "$FSINFO"
# btrfs reports subvolume sources as /dev/sda1[/subvol]; strip the suffix for lsblk
MOUNT_SOURCE="${MOUNT_SOURCE%%\[*}"


# 4. Handle Specific Filesystems
case "$FSTYPE" in
    nfs*|cifs|smb)
        log_error "Network filesystems ($FSTYPE) are not supported."
        exit "$EXIT_ERR_GENERIC"
        ;;
    overlay)
        log_error "OverlayFS (Docker container) is not currently supported."
        exit "$EXIT_ERR_UNSUPPORTED"
        ;;
    zfs)
        # The mount source is <pool>[/dataset...]; the pool name is the text
        # before the first slash.
        POOL_NAME="${MOUNT_SOURCE%%/*}"

        # List the pool's vdevs (-H: script mode, -P: full device paths) and
        # keep the /dev/* lines (the pool line itself has the pool name in $1).
        if ! ZFS_DEVS=$(zpool list -vHP "$POOL_NAME" 2>/dev/null | awk '$1 ~ /^\/dev\// { print $1 }'); then
            log_error "Could not list devices for ZFS pool '$POOL_NAME'."
            exit "$EXIT_ERR_GENERIC"
        fi
        if [[ -z "$ZFS_DEVS" ]]; then
            log_error "No physical devices found for ZFS pool '$POOL_NAME'."
            exit "$EXIT_ERR_GENERIC"
        fi

        # Take the first data vdev and fall through to the physical device
        # resolution below. Note: this is a heuristic; ZFS pools can span
        # multiple disks.
        MOUNT_SOURCE="${ZFS_DEVS%%$'\n'*}"
        ;;
    *)
        # Standard block devices (ext4, xfs, btrfs, etc.); MOUNT_SOURCE is
        # already set from findmnt above.
        ;;
esac

# 5. Resolve Physical Block Device
# If the mount source is empty, something went wrong.
if [[ -z "${MOUNT_SOURCE:-}" ]]; then
    log_error "Could not determine mount source."
    exit "$EXIT_ERR_GENERIC"
fi

# Resolve stable aliases such as /dev/root and /dev/disk/by-* before matching
# the source against lsblk. Some container environments expose the kernel block
# graph without device nodes, so retain the original path when it cannot be
# canonicalized and let the KNAME fallback below handle its basename.
if [[ "$MOUNT_SOURCE" == /dev/* && -e "$MOUNT_SOURCE" ]]; then
    MOUNT_SOURCE=$(readlink -f -- "$MOUNT_SOURCE")
fi

# Walk from the filesystem source through partitions, device-mapper nodes, LVM,
# RAID, and similar layers to the underlying whole disk.  Returning a made-up
# basename when lsblk cannot resolve the source makes iostat silently monitor the
# wrong device (for example, on tmpfs), so unresolved and multi-disk mappings are
# explicit errors.
SOURCE_ID=$(basename "$MOUNT_SOURCE")
mapfile -t PHYSICAL_DISKS < <(lsblk -rno NAME,KNAME,TYPE,PKNAME 2>/dev/null \
    | awk -v source="$SOURCE_ID" '
        function climb(node, edge, pair) {
            if (seen[node]++) return
            if (type[node] == "disk") {
                disks[node] = 1
                return
            }
            for (edge in parent) {
                split(edge, pair, SUBSEP)
                if (pair[1] == node) climb(pair[2])
            }
        }
        {
            type[$2] = $3
            if ($4 != "") parent[$2 SUBSEP $4] = 1
            if ($1 == source || $2 == source) starts[$2] = 1
        }
        END {
            for (node in starts) climb(node)
            for (node in disks) print node
        }' | sort -u)

if [[ "${#PHYSICAL_DISKS[@]}" -eq 0 ]]; then
    log_error "Could not resolve a physical block device for mount source '$MOUNT_SOURCE'."
    exit "$EXIT_ERR_GENERIC"
elif [[ "${#PHYSICAL_DISKS[@]}" -gt 1 ]]; then
    log_error "Mount source '$MOUNT_SOURCE' spans multiple physical devices (${PHYSICAL_DISKS[*]}); cannot resolve a single device."
    exit "$EXIT_ERR_UNSUPPORTED"
fi

echo "${PHYSICAL_DISKS[0]}"

exit "$EXIT_SUCCESS"
