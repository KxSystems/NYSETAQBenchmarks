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

# Handle LVM logical volumes. The filesystem on an LV reports as ext4/xfs/etc.,
# so LVM is detected here from the device type rather than the FSTYPE case above.
# An LV can be striped/mirrored across many physical volumes; we only resolve it
# when it maps to a single underlying disk, and error otherwise.
if ! SOURCE_TYPE=$(lsblk -dno TYPE "$MOUNT_SOURCE" 2>/dev/null); then
    log_error "'$MOUNT_SOURCE' is not a resolvable block device (fstype: $FSTYPE)."
    exit "$EXIT_ERR_UNSUPPORTED"
fi
if [[ "$SOURCE_TYPE" == "lvm" ]]; then
    # Walk the inverse dependency tree (-s) to the whole disks backing the LV.
    # KNAME avoids the tree-drawing characters added to the NAME column.
    mapfile -t LVM_DISKS < <(lsblk -sno KNAME,TYPE "$MOUNT_SOURCE" 2>/dev/null \
        | awk '$2 == "disk" { print $1 }' | sort -u)

    if [[ "${#LVM_DISKS[@]}" -eq 0 ]]; then
        log_error "Could not resolve any physical device for LVM volume '$MOUNT_SOURCE'."
        exit "$EXIT_ERR_GENERIC"
    elif [[ "${#LVM_DISKS[@]}" -gt 1 ]]; then
        log_error "LVM volume '$MOUNT_SOURCE' spans multiple physical devices (${LVM_DISKS[*]}); cannot resolve a single device."
        exit "$EXIT_ERR_UNSUPPORTED"
    fi

    echo "${LVM_DISKS[0]}"
    exit "$EXIT_SUCCESS"
fi

# Resolve the parent kernel name (physical disk) from the partition or logical volume.
# -d: don't print slaves (we want the parent)
# -n: no headings
# -o pkname: print parent kernel name
if ! PARENT_DEV=$(lsblk -dno pkname "$MOUNT_SOURCE" 2>/dev/null); then
    log_error "Could not resolve parent device for '$MOUNT_SOURCE'."
    exit "$EXIT_ERR_GENERIC"
fi

# If lsblk finds no parent (e.g., it is already the raw disk), default to the
# source's own kernel name. Both are bare names (psutil/iostat key format).
if [[ -n "$PARENT_DEV" ]]; then
    echo "$PARENT_DEV"
else
    basename "$MOUNT_SOURCE"
fi

exit "$EXIT_SUCCESS"