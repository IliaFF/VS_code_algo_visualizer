#pragma once

#include <cstddef>
#include <array>

constexpr auto kEps = 1e-9;

class Vector {
public:
    Vector();
    Vector(double x, double y, double z);

    double& operator[](size_t ind);
    double operator[](size_t ind) const;

    Vector& operator-=(const Vector& rhs);
    Vector& operator+=(const Vector& rhs);
    Vector operator-() const;

    void Normalize();
    void Scale(double value);
    void Flip();

private:
    std::array<double, 3> coordinates_{};
};

Vector operator-(Vector lhs, const Vector& rhs);
Vector operator+(Vector lhs, const Vector& rhs);
Vector operator*(Vector lhs, double value);
Vector operator*(double value, Vector rhs);
Vector operator+(double value, Vector rhs);
Vector operator*(const Vector& lhs, const Vector& rhs);

double DotProduct(const Vector& lhs, const Vector& rhs);
Vector CrossProduct(const Vector& a, const Vector& b);
double Length(const Vector& vec);
double Max(const Vector& vec);
