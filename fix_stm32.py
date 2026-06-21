#!/usr/bin/env python3
"""Fix STM32 flash memory mapping in QEMU picsimlab-stm32 branch."""

import sys

with open("/tmp/qemu-arm-build/hw/arm/stm32.c", "r") as f:
    content = f.read()

# The buggy legacy mode: flash ROM never created, so no memory at address 0
old_code = """  if (s->kernel_file) // Use legacy mode without reset support
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
  }"""

new_code = """  if (s->kernel_file) // Use legacy mode without reset support
  {
    /* Create flash ROM at address 0 where Cortex-M reads the vector table.
     * Without this, the CPU reads SP=0 and PC=0 from an empty address space,
     * causing "Lockup: can't take terminal derived exception". */
    MemoryRegion *flash = g_new(MemoryRegion, 1);
    memory_region_init_rom(flash, NULL, "stm32.flash", s->flash_size, &error_fatal);
    memory_region_add_subregion(address_space_mem, 0, flash);

    /* Alias 0x08000000 -> 0 so code compiled for flash base address also works.
     * Real hardware aliases 0 -> 0x08000000; we do the reverse for QEMU. */
    MemoryRegion *flash_alias_mem = g_malloc(sizeof(MemoryRegion));
    memory_region_init_alias(flash_alias_mem, NULL, "stm32-flash-alias-mem",
                             address_space_mem, 0, s->flash_size);
    memory_region_add_subregion(address_space_mem, STM32_FLASH_ADDR_START,
                                flash_alias_mem);
  }"""

if old_code in content:
    content = content.replace(old_code, new_code)
    with open("/tmp/qemu-arm-build/hw/arm/stm32.c", "w") as f:
        f.write(content)
    print("PATCHED stm32.c - added flash ROM init in legacy kernel mode")
else:
    print("ERROR: old_code not found in stm32.c")
    # Show what's near the relevant line
    for i, line in enumerate(content.split('\n')):
        if 'flash_alias_mem = g_malloc' in line:
            print(f"Found at line {i+1}: {line.strip()}")
    sys.exit(1)
