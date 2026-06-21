#!/usr/bin/env python3
"""Fix stm32.c flash mapping - v2 correct direction."""
import sys

path = "/tmp/qemu-arm-build/hw/arm/stm32.c"
with open(path + ".bak", "r") as f:
    content = f.read()

# The buggy legacy code
old = '''  if (s->kernel_file) // Use legacy mode without reset support
  {
    MemoryRegion *flash_alias_mem = g_malloc(sizeof(MemoryRegion));
    /* The STM32 family stores its Flash memory at some base address in memory
     * (0x08000000 for medium density devices), and then aliases it to the
     * boot memory space, which starts at 0x00000000 (the "System Memory" can
     * also be aliased to 0x00000000, but this is not implemented here). The
     * processor executes the code in the aliased memory at 0x00000000.  We need
     * to make a QEMU alias so that reads in the 0x08000000 area are passed
     * through to the 0x00000000 area. Note that this is the opposite of real
     * hardware, where the memory at 0x00000000 passes reads through the "real"
     * flash memory at 0x08000000, but it works the same either way. */
    /* TODO: Parameterize the base address of the aliased memory. */
    memory_region_init_alias(flash_alias_mem, NULL, "stm32-flash-alias-mem",
                             address_space_mem, 0, s->flash_size);
    memory_region_add_subregion(address_space_mem, STM32_FLASH_ADDR_START,
                                flash_alias_mem);
  }'''

new = '''  if (s->kernel_file) // Use legacy mode without reset support
  {
    /* Allocate writable flash at 0x08000000 where the kernel loader writes */
    MemoryRegion *flash = g_new(MemoryRegion, 1);
    memory_region_init_ram(flash, NULL, "stm32.flash", s->flash_size, &error_fatal);
    memory_region_add_subregion(address_space_mem, STM32_FLASH_ADDR_START, flash);

    /* Alias address 0 -> flash so Cortex-M reads the vector table */
    MemoryRegion *flash_alias_mem = g_malloc(sizeof(MemoryRegion));
    memory_region_init_alias(flash_alias_mem, NULL, "stm32-flash-alias-mem",
                             address_space_mem, STM32_FLASH_ADDR_START, s->flash_size);
    memory_region_add_subregion(address_space_mem, 0, flash_alias_mem);
  }'''

if old in content:
    content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)
    print("OK: patched stm32.c v2 (flash at 0x08000000, alias 0->0x08000000)")
else:
    print("ERROR: old pattern not found - file may already be patched")
    # Check what's there
    if 'memory_region_init_ram(flash' in content:
        print("  Already has memory_region_init_ram - looks patched")
    sys.exit(1)
