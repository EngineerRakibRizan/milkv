<?php

namespace Tests\Unit;

use App\Support\Units;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class UnitsTest extends TestCase
{
    public function test_money_parses_decimal_strings_without_float_error(): void
    {
        $this->assertSame(125050, Units::money('1250.50'));
        $this->assertSame(10, Units::money('0.1'));
        $this->assertSame(30, Units::money('0.1') + Units::money('0.2'));
        $this->assertSame(1, Units::money('0.005'));   // rounds half up
        $this->assertSame(0, Units::money('0.004'));
        $this->assertSame(-1999, Units::money('-19.99'));
        $this->assertSame(0, Units::money(null));
        $this->assertSame(500, Units::money(5));
    }

    public function test_quantity_uses_milli_units(): void
    {
        $this->assertSame(12500, Units::qty('12.5'));
        $this->assertSame(1, Units::qty('0.001'));
        $this->assertSame('12.500', Units::q(12500));
        $this->assertSame('-0.05', Units::m(-5));
    }

    public function test_line_amount_rounds_half_up(): void
    {
        // 2.5 L × ৳90.00 = ৳225.00
        $this->assertSame(22500, Units::lineAmount(2500, 9000));
        // 0.333 kg × ৳0.15 = 4.995 paisa → 5
        $this->assertSame(5, Units::lineAmount(333, 15));
    }

    public function test_rejects_garbage(): void
    {
        $this->expectException(InvalidArgumentException::class);
        Units::money('12,5abc');
    }
}
