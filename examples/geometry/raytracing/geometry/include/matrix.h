#pragma once

#include <cstddef>
#include <vector>

class Matrix {
public:
    explicit Matrix(size_t n);
    Matrix(size_t m, size_t n);
    explicit Matrix(const std::vector<std::vector<double>>& data);

    size_t Rows() const;
    size_t Columns() const;

    double& operator()(size_t i, size_t j);
    double operator()(size_t i, size_t j) const;

    Matrix& operator+=(const Matrix& rhs);
    Matrix& operator-=(const Matrix& rhs);
    Matrix& operator*=(const Matrix& rhs);

private:
    size_t rows_;
    size_t columns_;
    std::vector<double> data_;
};

Matrix Transpose(const Matrix& matrix);
Matrix operator+(Matrix lhs, const Matrix& rhs);
Matrix operator-(Matrix lhs, const Matrix& rhs);
Matrix operator*(const Matrix& lhs, const Matrix& rhs);
Matrix Identity(size_t n);
