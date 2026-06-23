#!/usr/bin/env bash

if [ $# -eq 0 ]; then
    error_handler "No directory specified. Usage: $0 <directory>"
fi

DBDIR=$1

declare -A zfs_pools

if [[ $(findmnt -n -o FSTYPE -T ${DBDIR}) == "zfs" ]]; then
	pool=$(findmnt -n -o SOURCE -T ${DBDIR})
	echo "${partition} is on zfs pool ${pool}"
	zfs_pools[$pool]=1
else
	echo "syncing ${DBDIR}"
	sync ${DBDIR}
fi


unique_pools=("${!zfs_pools[@]}")

echo "Flushing caches"

if [ $(uname -s) = "Darwin" ]; then
	${SUDO} purge
else
	if [[ ${#unique_pools[@]} -gt 0 ]]; then
		for pool in "${unique_pools[@]}"; do
    		echo "Exporting ZFS pool: $pool"
			if ! ${SUDO} zpool export $pool; then
				echo "Error: Failed to export ZFS pool '$pool'. Aborting."
      			exit 1
    		fi
		done
	fi

	echo "Flushing page cache"
	echo 3 | ${SUDO} tee /proc/sys/vm/drop_caches > /dev/null
	echo "sleeping a bit"
	sleep 0.2

	if [[ ${#unique_pools[@]} -gt 0 ]]; then
		for pool in "${unique_pools[@]}"; do
    		echo "Importing ZFS pool: $pool"
			if ! ${SUDO} zpool import $pool; then
				echo "Error: Failed to import ZFS pool '$pool'. Aborting."
      			exit 1
    		fi
		done
	fi
fi

echo "Flush process complete."